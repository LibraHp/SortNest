use crate::{db, scanner, Core};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::Client;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Cursor, path::Path, time::Duration};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub remote_consent: bool,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub capabilities: Value,
    #[serde(default)]
    pub vision_prompt: String,
    #[serde(default = "default_vision_max_tokens")]
    pub vision_max_tokens: u32,
}
fn default_vision_max_tokens() -> u32 {
    4096
}
pub const DEFAULT_VISION_PROMPT: &str =
    "用一到三句中文客观描述图片的主体、场景、风格与色彩。仅返回描述，不要推测身份或不可见的细节。";
impl Model {
    pub fn vision_prompt(&self) -> &str {
        if self.vision_prompt.trim().is_empty() {
            DEFAULT_VISION_PROMPT
        } else {
            self.vision_prompt.trim()
        }
    }
    pub fn vision_fingerprint(&self) -> String {
        let settings = json!([
            "vision-v2",
            self.fingerprint,
            self.vision_prompt(),
            self.vision_max_tokens
        ]);
        format!("{:x}", Sha256::digest(settings.to_string().as_bytes()))
    }
}
pub fn is_loopback(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| matches!(h, "127.0.0.1" | "localhost" | "[::1]" | "::1"))
        })
        .unwrap_or(false)
}
fn ollama_model<'a>(data: &'a Value, name: &str) -> Result<&'a Value> {
    data["models"]
        .as_array()
        .and_then(|items| {
            items.iter().find(|item| {
                item["name"]
                    .as_str()
                    .is_some_and(|n| n == name || n == format!("{name}:latest"))
            })
        })
        .context("Ollama 服务可连接，但没有找到配置的模型")
}

fn ollama_revision<'a>(data: &'a Value, name: &str) -> Result<&'a str> {
    ollama_model(data, name)?["digest"]
        .as_str()
        .filter(|s| !s.is_empty())
        .context("Ollama 没有返回模型 digest，无法验证向量索引版本")
}
pub fn validate(m: &Model) -> Result<()> {
    if m.vision_prompt.chars().count() > 8000 {
        bail!("图片理解提示词不能超过 8000 字")
    }
    if !(256..=32768).contains(&m.vision_max_tokens) {
        bail!("图片理解输出上限必须为 256 至 32768 tokens")
    }
    let u = reqwest::Url::parse(&m.base_url).context("Base URL 格式不正确")?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        bail!("仅支持 HTTP/HTTPS 服务")
    }
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        bail!("URL 不应包含凭据、查询参数或片段，请在 API Key 栏填写凭据")
    }
    if !matches!(m.provider.as_str(), "ollama" | "openai" | "wemm") {
        bail!("未知模型提供商")
    }
    if m.provider == "wemm" && !is_loopback(&m.base_url) {
        bail!("WeMM 本地适配器只允许回环地址")
    }
    if m.name.trim().is_empty() || m.model.trim().is_empty() {
        bail!("请填写配置名称和模型名称")
    }
    Ok(())
}
pub fn fingerprint(m: &Model) -> String {
    let value = format!(
        "sortnest-v1|{}|{}|{}|{}",
        m.provider,
        m.base_url.trim_end_matches('/'),
        m.model,
        m.revision
    );
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn credential(id: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new("SortNest", id)?)
}
pub fn catalog(value: Value) -> Result<Value> {
    let mut model: Model = serde_json::from_value(value.clone())?;
    if model.id.is_empty() {
        model.id = uuid::Uuid::new_v4().to_string();
    }
    if model.name.is_empty() {
        model.name = "连接测试".into();
    }
    if model.model.is_empty() {
        model.model = "discovery".into();
    }
    let mut provider = HttpProvider::new(model)?;
    if let Some(key) = value["api_key"].as_str().filter(|s| !s.is_empty()) {
        provider.key = Some(key.to_owned());
    }
    let (path, array, key) = match provider.config.provider.as_str() {
        "ollama" => ("/api/tags", "models", "name"),
        "wemm" => ("/health", "", "model"),
        _ => ("/models", "data", "id"),
    };
    let response = provider.request(path, None)?;
    let names: Vec<String> = if array.is_empty() {
        vec![response[key]
            .as_str()
            .context("响应缺少模型名称")?
            .to_owned()]
    } else {
        response[array]
            .as_array()
            .context("服务没有返回模型列表")?
            .iter()
            .filter_map(|v| v[key].as_str().map(str::to_owned))
            .collect()
    };
    Ok(json!(names))
}
pub fn save(core: &Core, value: Value) -> Result<Value> {
    let mut m: Model = serde_json::from_value(value.clone())?;
    validate(&m)?;
    if m.id.is_empty() {
        m.id = uuid::Uuid::new_v4().to_string();
    }
    m.fingerprint = fingerprint(&m);
    let mut db = core.db()?;
    if value["clear_key"].as_bool() == Some(true) {
        let _ = credential(&m.id)?.delete_credential();
    }
    if let Some(key) = value["api_key"].as_str().filter(|s| !s.is_empty()) {
        credential(&m.id)?
            .set_password(key)
            .context("无法将 API Key 保存到 Windows 凭据管理器")?;
    }
    let tx = db.transaction()?;
    tx.execute("INSERT INTO models(id,name,provider,base_url,model,revision,remote_consent,fingerprint) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,revision=excluded.revision,remote_consent=excluded.remote_consent,capabilities=CASE WHEN fingerprint=excluded.fingerprint THEN capabilities ELSE '{}' END,last_test=CASE WHEN fingerprint=excluded.fingerprint THEN last_test ELSE NULL END,test_result=CASE WHEN fingerprint=excluded.fingerprint THEN test_result ELSE NULL END,fingerprint=excluded.fingerprint",params![m.id,m.name,m.provider,m.base_url.trim_end_matches('/'),m.model,m.revision,m.remote_consent,m.fingerprint])?;
    tx.execute("UPDATE models SET capabilities=json_remove(capabilities,'$.vision','$.sample'),last_test=NULL,test_result=NULL WHERE id=? AND (vision_prompt<>? OR vision_max_tokens<>?)", params![m.id,m.vision_prompt,m.vision_max_tokens])?;
    tx.execute(
        "UPDATE models SET vision_prompt=?,vision_max_tokens=? WHERE id=?",
        params![m.vision_prompt, m.vision_max_tokens, m.id],
    )?;
    tx.commit()?;
    Ok(json!({"id":m.id}))
}
pub fn load(core: &Core, id: &str) -> Result<Model> {
    let db = core.db()?;
    let mut r = db::rows(&db, "SELECT * FROM models WHERE id=?", [id])?
        .pop()
        .context("模型配置不存在")?;
    r["remote_consent"] = json!(r["remote_consent"].as_i64() == Some(1));
    r["capabilities"] = serde_json::from_str(r["capabilities"].as_str().unwrap_or("{}"))?;
    Ok(serde_json::from_value(r)?)
}
pub fn assigned(core: &Core, task: &str) -> Result<Model> {
    let id: Option<String> = core
        .db()?
        .query_row(
            "SELECT model_id FROM task_models WHERE task=?",
            [task],
            |r| r.get(0),
        )
        .optional()?;
    load(core, &id.context(format!("请先为「{task}」配置模型"))?)
}
pub trait ModelProvider {
    fn available(&self) -> Result<Value>;
    fn text_embedding(&self, text: &str) -> Result<Vec<f32>>;
    fn image_embedding(&self, path: &Path) -> Result<Vec<f32>>;
    fn understand(&self, path: &Path, prompt: &str) -> Result<String>;
}
pub struct HttpProvider {
    pub config: Model,
    client: Client,
    key: Option<String>,
}
impl HttpProvider {
    pub fn new(config: Model) -> Result<Self> {
        validate(&config)?;
        if !is_loopback(&config.base_url) && !config.remote_consent {
            bail!("此配置指向远程服务。请先确认允许发送文本和图片内容。")
        }
        let key = credential(&config.id)?.get_password().ok();
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            config,
            client,
            key,
        })
    }
    fn request(&self, path: &str, body: Option<Value>) -> Result<Value> {
        let ollama_image = self.config.provider == "ollama"
            && path == "/api/embed"
            && body
                .as_ref()
                .is_some_and(|b| b["input"]["image"].is_string());
        let url = format!("{}{}", self.config.base_url.trim_end_matches('/'), path);
        let mut request = if let Some(body) = body {
            self.client.post(url).json(&body)
        } else {
            self.client.get(url)
        };
        if let Some(key) = &self.key {
            request = request.bearer_auth(key);
        }
        let response = request.send().map_err(|e| {
            if e.is_timeout() {
                anyhow::anyhow!("模型请求超时（最长 300 秒）")
            } else {
                anyhow::anyhow!("无法连接模型服务，请检查服务地址和运行状态")
            }
        })?;
        let status = response.status();
        if !status.is_success() {
            if ollama_image && status.as_u16() == 501 {
                bail!("Ollama 当前模型不支持图片嵌入（HTTP 501 / media embeddings）。文本嵌入可用不代表图片嵌入可用；请使用支持图片嵌入的 Ollama 模型，或选择本地 WeMM。")
            }
            if ollama_image && status.as_u16() == 400 {
                bail!("Ollama 拒绝图片嵌入请求（HTTP 400）。请确认服务支持 /api/embed 的 input.image 格式，并且该模型支持图片嵌入。")
            }
            bail!(
                "模型服务返回 HTTP {}，请检查模型、凭据与接口兼容性",
                status.as_u16()
            )
        }
        if response.content_length().unwrap_or(0) > 16 * 1024 * 1024 {
            bail!("模型响应过大")
        }
        response.json().context("模型响应不是有效 JSON")
    }
    fn check_revision(&self, response: &Value) -> Result<()> {
        if self.config.provider == "wemm"
            && response["revision"].as_str() != Some(self.config.revision.as_str())
        {
            bail!("本地模型权重或预处理版本已变化。请重新运行连接测试、能力测试，并重建向量索引。")
        }
        Ok(())
    }
    fn check_ollama_revision(&self) -> Result<()> {
        if self.config.revision.is_empty() {
            bail!("请先运行 Ollama 连接测试，记录模型版本后再测试嵌入能力")
        }
        let info = self.available()?;
        if ollama_revision(&info, &self.config.model)? != self.config.revision {
            bail!("Ollama 模型版本已变化，请重新运行连接与能力测试，并重建向量索引")
        }
        Ok(())
    }
}
pub fn image_base64(path: &Path) -> Result<String> {
    let img = scanner::decode(path)?.thumbnail(1024, 1024).to_rgb8();
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Jpeg)?;
    Ok(STANDARD.encode(out.into_inner()))
}
pub fn normalize(mut v: Vec<f32>) -> Result<Vec<f32>> {
    if v.is_empty() || v.len() > 65536 || v.iter().any(|x| !x.is_finite()) {
        bail!("模型返回无效向量")
    }
    let norm = v.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt();
    if norm < 1e-12 {
        bail!("模型返回零向量")
    }
    for x in &mut v {
        *x = (*x as f64 / norm) as f32;
    }
    Ok(v)
}
fn vector(v: &Value) -> Result<Vec<f32>> {
    normalize(serde_json::from_value(v.clone()).context("响应中缺少 embedding 数组")?)
}
fn chat_text(response: &Value, ollama: bool) -> Result<String> {
    if response.get("error").is_some_and(|v| !v.is_null()) {
        bail!("服务返回了错误对象而非图片理解结果，请检查服务端日志、模型名称与接口配置")
    }
    let choice = &response["choices"][0];
    let message = if ollama {
        &response["message"]
    } else {
        &choice["message"]
    };
    let reason = if ollama {
        response["done_reason"].as_str()
    } else {
        choice["finish_reason"].as_str()
    };
    if reason == Some("content_filter")
        || message["refusal"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty())
    {
        bail!("模型拒绝处理这张图片或触发内容过滤；请更换测试图片或检查服务的内容策略")
    }
    if reason == Some("length") {
        bail!("图片理解达到输出上限，回答未完成（finish_reason=length）。请在模型管理中提高「图片理解输出上限」，或在服务端关闭推理模式后重试")
    }
    let content = &message["content"];
    let text = if let Some(s) = content.as_str() {
        s.to_owned()
    } else if let Some(parts) = content.as_array() {
        let mut texts = Vec::new();
        for part in parts {
            match part["type"].as_str() {
                Some("refusal") => {
                    bail!("模型拒绝处理这张图片，请更换测试图片或检查服务的内容策略")
                }
                Some("text" | "output_text") => {
                    if let Some(s) = part["text"].as_str() {
                        texts.push(s);
                    }
                }
                _ => {}
            }
        }
        texts.join("\n")
    } else {
        String::new()
    };
    if !text.trim().is_empty() {
        return Ok(text.trim().to_owned());
    }
    if ["reasoning_content", "reasoning", "thinking"]
        .iter()
        .any(|key| message[*key].as_str().is_some_and(|s| !s.trim().is_empty()))
    {
        bail!("模型只返回推理内容，没有最终回答。请提高「图片理解输出上限」或在服务端关闭推理模式；推理内容不会作为图片描述保存")
    }
    if response.get("output").is_some() {
        bail!("服务返回 Responses 格式；当前适配器需要 /chat/completions，请检查 Base URL 或网关的协议转换设置")
    }
    if message.is_null() {
        bail!("响应缺少图片理解消息；OpenAI 兼容服务须返回 choices[0].message，Ollama 须返回 message。请检查接口协议")
    }
    bail!("模型未返回可用正文（content 为空或格式不兼容）。请用另一张图片运行「图片理解」测试，并检查模型是否支持图片输入")
}
impl ModelProvider for HttpProvider {
    fn available(&self) -> Result<Value> {
        match self.config.provider.as_str() {
            "ollama" => {
                let data = self.request("/api/tags", None)?;
                ollama_model(&data, &self.config.model)?;
                Ok(data)
            }
            "wemm" => {
                let v = self.request("/health", None)?;
                if v["model"].as_str() != Some(&self.config.model) || v["ready"] != true {
                    bail!("本地服务模型未就绪或名称不匹配")
                };
                Ok(v)
            }
            _ => {
                let v = self.request("/models", None)?;
                let exists = v["data"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .any(|m| m["id"].as_str() == Some(&self.config.model))
                    })
                    .unwrap_or(false);
                if !exists {
                    bail!("服务 /models 未列出该模型；可直接运行下方能力测试验证")
                };
                Ok(v)
            }
        }
    }
    fn text_embedding(&self, text: &str) -> Result<Vec<f32>> {
        let m = &self.config.model;
        match self.config.provider.as_str() {
            "ollama" => {
                self.check_ollama_revision()?;
                let v = self.request("/api/embed", Some(json!({"model":m,"input":text})))?;
                vector(&v["embeddings"][0])
            }
            "wemm" => {
                let v = self.request("/embed", Some(json!({"model":m,"text":text})))?;
                self.check_revision(&v)?;
                vector(&v["embedding"])
            }
            _ => {
                let v = self.request(
                    "/embeddings",
                    Some(json!({"model":m,"input":text,"encoding_format":"float"})),
                )?;
                vector(&v["data"][0]["embedding"])
            }
        }
    }
    fn image_embedding(&self, path: &Path) -> Result<Vec<f32>> {
        match self.config.provider.as_str() {
            "wemm" => {
                let v = self.request("/embed", Some(json!({"model":self.config.model,"image":image_base64(path)?})))?;
                self.check_revision(&v)?;
                vector(&v["embedding"])
            }
            "ollama" => {
                self.check_ollama_revision()?;
                let v = self.request("/api/embed", Some(json!({"model":self.config.model,"input":{"image":image_base64(path)?}})))?;
                vector(&v["embeddings"][0])
            }
            _ => bail!("标准 OpenAI /embeddings 适配器仅支持文本输入。图片向量请使用本地 WeMM 或通过图片嵌入测试的 Ollama 模型；也可使用描述语义检索。"),
        }
    }
    fn understand(&self, path: &Path, prompt: &str) -> Result<String> {
        let image = image_base64(path)?;
        let m = &self.config.model;
        let response=match self.config.provider.as_str(){
            "ollama"=>self.request("/api/chat",Some(json!({"model":m,"stream":false,"options":{"num_predict":self.config.vision_max_tokens},"messages":[{"role":"user","content":prompt,"images":[image]}]})))?,
            "openai"=>self.request("/chat/completions",Some(json!({"model":m,"stream":false,"messages":[{"role":"user","content":[{"type":"text","text":prompt},{"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image}")}}]}],"max_tokens":self.config.vision_max_tokens})))?,
            _=>bail!("WeMM 为嵌入模型，不能生成描述、分类或标签")
        };
        chat_text(&response, self.config.provider == "ollama")
    }
}
pub fn test(core: &Core, id: &str, kind: &str, path: Option<&str>) -> Result<Value> {
    let mut m = load(core, id)?;
    let result = (|| -> Result<Value> {
        if matches!(m.provider.as_str(), "wemm" | "ollama") && kind == "connection" {
            let info = HttpProvider::new(m.clone())?.available()?;
            let revision = if m.provider == "ollama" {
                ollama_revision(&info, &m.model)?
            } else {
                info["revision"]
                    .as_str()
                    .context("WeMM 服务没有提供模型版本指纹")?
            };
            if revision != m.revision {
                m.revision = revision.to_owned();
                m.fingerprint = fingerprint(&m);
                m.capabilities = json!({});
                core.db()?.execute(
                    "UPDATE models SET revision=?,fingerprint=?,capabilities='{}' WHERE id=?",
                    params![m.revision, m.fingerprint, id],
                )?;
            }
        }
        let provider = HttpProvider::new(m.clone())?;
        match kind {
            "connection" => {
                provider.available()?;
                Ok(json!({"connection":true}))
            }
            "text" => {
                let v = provider.text_embedding("一只橘猫坐在窗边")?;
                Ok(json!({"text":true,"text_dimension":v.len()}))
            }
            "image" => {
                let p = path.context("请选择测试图片")?;
                let v = provider.image_embedding(Path::new(p))?;
                Ok(json!({"image":true,"image_dimension":v.len()}))
            }
            "vision" => {
                let p = path.context("请选择测试图片")?;
                let text = provider.understand(Path::new(p), m.vision_prompt())?;
                Ok(json!({"vision":true,"sample":text}))
            }
            _ => bail!("未知能力测试"),
        }
    })();
    let db = core.db()?;
    let mut caps = m.capabilities.as_object().cloned().unwrap_or_default();
    match &result {
        Ok(v) => {
            for (k, v) in v.as_object().unwrap() {
                caps.insert(k.clone(), v.clone());
            }
        }
        Err(_) => {
            caps.insert(kind.to_string(), json!(false));
            caps.remove(&format!("{kind}_dimension"));
            if kind == "vision" {
                caps.remove("sample");
            }
        }
    }
    let report = match &result {
        Ok(v) => v.to_string(),
        Err(e) => e.to_string(),
    };
    db.execute("UPDATE models SET capabilities=?,test_result=?,last_test=CURRENT_TIMESTAMP WHERE id=? AND fingerprint=? AND vision_prompt=? AND vision_max_tokens=?",params![Value::Object(caps).to_string(),report,id,m.fingerprint,m.vision_prompt,m.vision_max_tokens])?;
    result
}
pub fn require(m: &Model, capability: &str) -> Result<()> {
    if m.capabilities[capability] != true {
        bail!("请先通过模型的 {capability} 能力测试")
    };
    Ok(())
}
pub fn compatible(a: &Model, b: &Model) -> Result<()> {
    require(a, "image")?;
    require(b, "text")?;
    if a.fingerprint != b.fingerprint
        || a.provider != b.provider
        || !matches!(a.provider.as_str(), "wemm" | "ollama")
        || a.revision.is_empty()
        || a.revision != b.revision
        || a.capabilities["image_dimension"] != b.capabilities["text_dimension"]
    {
        bail!("文本与图片向量空间不兼容；需要同一 WeMM 或 Ollama 模型、版本、服务和实测维度，且文本与图片嵌入测试均通过")
    }
    Ok(())
}
pub fn pack(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}
pub fn unpack(bytes: &[u8]) -> Result<Vec<f32>> {
    if bytes.len() % 4 != 0 {
        bail!("向量数据损坏")
    };
    normalize(
        bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect(),
    )
}
pub fn cosine(a: &[f32], b: &[f32]) -> Result<f32> {
    if a.len() != b.len() {
        bail!("向量维度不兼容")
    };
    Ok(a.iter()
        .zip(b)
        .map(|(a, b)| a * b)
        .sum::<f32>()
        .clamp(-1.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chat_response_accepts_text_blocks_but_never_reasoning_as_answer() {
        assert_eq!(
            chat_text(
                &json!({"choices":[{"message":{"content":" 一只猫 "}}]}),
                false
            )
            .unwrap(),
            "一只猫"
        );
        assert_eq!(chat_text(&json!({"choices":[{"message":{"content":[{"type":"text","text":"主体：猫"},{"type":"reasoning","text":"hidden"},{"type":"output_text","text":"场景：室内"}]}}]}), false).unwrap(), "主体：猫\n场景：室内");
        assert_eq!(
            chat_text(
                &json!({"message":{"content":"猫","thinking":"hidden"},"done_reason":"stop"}),
                true
            )
            .unwrap(),
            "猫"
        );
        for (response, expected) in [
            (
                json!({"choices":[{"finish_reason":"length","message":{"content":"不完整","reasoning_content":"hidden"}}]}),
                "输出上限",
            ),
            (
                json!({"choices":[{"message":{"content":null,"reasoning_content":"hidden"}}]}),
                "只返回推理内容",
            ),
            (
                json!({"choices":[{"finish_reason":"content_filter","message":{"content":""}}]}),
                "内容过滤",
            ),
            (
                json!({"choices":[{"message":{"refusal":"secret","content":""}}]}),
                "拒绝",
            ),
            (
                json!({"choices":[{"message":{"content":[{"type":"refusal","refusal":"secret"}]}}]}),
                "拒绝",
            ),
            (json!({"output":[]}), "Responses"),
            (json!({"error":{"message":"secret"}}), "错误对象"),
            (json!({"choices":[]}), "响应缺少"),
            (json!({"choices":[{"message":{"content":" "}}]}), "正文"),
        ] {
            let error = chat_text(&response, false).unwrap_err().to_string();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("hidden") && !error.contains("secret"));
        }
        assert!(chat_text(
            &json!({"message":{"content":"partial"},"done_reason":"length"}),
            true
        )
        .is_err());
    }

    #[test]
    fn vision_settings_persist_and_invalidate_only_vision_capabilities() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().to_path_buf()).unwrap();
        let mut config = json!({"id":"vision-settings","name":"Test","provider":"openai","base_url":"http://127.0.0.1:1","model":"fixture"});
        save(&core, config.clone()).unwrap();
        let initial = load(&core, "vision-settings").unwrap();
        assert_eq!(initial.vision_max_tokens, 4096);
        assert_eq!(initial.vision_prompt(), DEFAULT_VISION_PROMPT);
        core.db()
            .unwrap()
            .execute(
                "UPDATE models SET capabilities=? WHERE id='vision-settings'",
                [
                    json!({"text":true,"text_dimension":2,"vision":true,"sample":"old"})
                        .to_string(),
                ],
            )
            .unwrap();
        config["vision_prompt"] = json!("请重点描述画面中的文字和界面。");
        config["vision_max_tokens"] = json!(8192);
        save(&core, config.clone()).unwrap();
        let updated = load(&core, "vision-settings").unwrap();
        assert_eq!(updated.vision_prompt(), "请重点描述画面中的文字和界面。");
        assert_eq!(updated.vision_max_tokens, 8192);
        assert_eq!(initial.fingerprint, updated.fingerprint);
        assert_ne!(initial.vision_fingerprint(), updated.vision_fingerprint());
        assert_eq!(updated.capabilities["text"], true);
        assert_eq!(updated.capabilities["text_dimension"], 2);
        assert!(updated.capabilities["vision"].is_null());
        assert!(updated.capabilities["sample"].is_null());
        for invalid in [0, 255, 32769] {
            config["vision_max_tokens"] = json!(invalid);
            assert!(save(&core, config.clone()).is_err());
        }
        config["vision_max_tokens"] = json!(4096);
        config["vision_prompt"] = json!("字".repeat(8001));
        assert!(save(&core, config).is_err());
    }
    #[test]
    fn vectors_are_checked() {
        assert!(normalize(vec![0., 0.]).is_err());
        assert!(normalize(vec![f32::NAN]).is_err());
        assert!(cosine(&[1.], &[1., 0.]).is_err());
        let v = normalize(vec![3., 4.]).unwrap();
        assert!((cosine(&v, &unpack(&pack(&v)).unwrap()).unwrap() - 1.).abs() < 1e-5);
    }
    #[test]
    fn remote_boundary() {
        assert!(is_loopback("http://127.0.0.1:8787"));
        assert!(!is_loopback("https://localhost.evil.test"));
    }
    // HTTP contract fixtures validate transport and version handling, not model quality.
    fn ollama_fixture(responses: Vec<(u16, Value)>) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            for (status, response) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                let (header_end, length) = loop {
                    let read = stream.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                    if let Some(end) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                        let length = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length: "))
                            .unwrap_or("0")
                            .parse::<usize>()
                            .unwrap();
                        break (end + 4, length);
                    }
                };
                while request.len() < header_end + length {
                    let read = stream.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                }
                let headers = String::from_utf8_lossy(&request[..header_end]);
                if response.get("models").is_some() {
                    assert!(headers.starts_with("GET /api/tags "));
                } else {
                    assert!(headers.starts_with("POST /api/embed "));
                    let body: Value = serde_json::from_slice(&request[header_end..]).unwrap();
                    assert_eq!(body["model"], "fixture");
                    if body["input"].is_object() {
                        let image = STANDARD
                            .decode(body["input"]["image"].as_str().unwrap())
                            .unwrap();
                        assert!(image::load_from_memory(&image).is_ok());
                        assert_eq!(body["input"].as_object().unwrap().len(), 1);
                        assert!(body.get("images").is_none());
                    } else {
                        assert_eq!(body["input"], "一只橘猫坐在窗边");
                    }
                }
                let body = response.to_string();
                write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        (url, worker)
    }
    #[test]
    fn ollama_media_protocol_records_capabilities_and_invalidates_changed_models() {
        let tags = json!({"models":[{"name":"fixture:latest","digest":"digest-v1"}]});
        let changed = json!({"models":[{"name":"fixture:latest","digest":"digest-v2"}]});
        let embedding = json!({"embeddings":[[3.0,4.0]]});
        let (url, worker) = ollama_fixture(vec![
            (200, tags.clone()),
            (200, tags.clone()), // connection records digest
            (200, tags.clone()),
            (200, embedding.clone()), // text
            (200, tags),
            (200, embedding),       // image
            (200, changed.clone()), // stale model refuses inference
            (200, changed.clone()),
            (200, changed), // reconnect invalidates capabilities
        ]);
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().join("data")).unwrap();
        let picture = root.path().join("test.png");
        image::RgbImage::new(16, 16).save(&picture).unwrap();
        let saved = save(
            &core,
            json!({"id":"","name":"Fixture","provider":"ollama","base_url":url,"model":"fixture"}),
        )
        .unwrap();
        let id = saved["id"].as_str().unwrap();
        test(&core, id, "connection", None).unwrap();
        test(&core, id, "text", None).unwrap();
        test(&core, id, "image", picture.to_str()).unwrap();
        let model = load(&core, id).unwrap();
        assert_eq!(model.revision, "digest-v1");
        assert_eq!(model.capabilities["image_dimension"], 2);
        compatible(&model, &model).unwrap();
        let mut other = model.clone();
        other.fingerprint = "different-model".into();
        assert!(compatible(&model, &other).is_err());
        other = model.clone();
        other.capabilities["text_dimension"] = json!(3);
        assert!(compatible(&model, &other).is_err());
        assert!(HttpProvider::new(model.clone())
            .unwrap()
            .text_embedding("query")
            .unwrap_err()
            .to_string()
            .contains("版本已变化"));
        test(&core, id, "connection", None).unwrap();
        let fresh = load(&core, id).unwrap();
        assert_eq!(fresh.revision, "digest-v2");
        assert_ne!(fresh.fingerprint, model.fingerprint);
        assert_ne!(fresh.capabilities["image"], true);
        assert_ne!(fresh.capabilities["text"], true);
        worker.join().unwrap();
    }
    #[test]
    fn ollama_rejected_image_is_not_marked_capable() {
        for (status, response) in [
            (
                501,
                json!({"error":"model does not support media embeddings"}),
            ),
            (200, json!({"embeddings":[]})),
        ] {
            let (url, worker) = ollama_fixture(vec![
                (200, json!({"models":[{"name":"fixture","digest":"v1"}]})),
                (status, response),
            ]);
            let root = tempfile::tempdir().unwrap();
            let core = Core::new(root.path().join("data")).unwrap();
            let picture = root.path().join("test.png");
            image::RgbImage::new(16, 16).save(&picture).unwrap();
            let saved=save(&core,json!({"id":"","name":"Fixture","provider":"ollama","base_url":url,"model":"fixture","revision":"v1"})).unwrap();
            let id = saved["id"].as_str().unwrap();
            let error = test(&core, id, "image", picture.to_str())
                .unwrap_err()
                .to_string();
            if status == 501 {
                assert!(error.contains("不支持图片嵌入"), "{error}");
            }
            assert_eq!(load(&core, id).unwrap().capabilities["image"], false);
            worker.join().unwrap();
        }
    }
    #[test]
    fn remote_http_configs_persist_and_require_consent_before_use() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::new(root.path().to_path_buf()).unwrap();
        for provider in ["openai", "ollama"] {
            for url in [
                "http://192.168.1.10:8000/v1",
                "http://model.example.test:11434",
                "https://model.example.test/v1",
            ] {
                let result = save(
                    &core,
                    json!({
                        "id": "", "name": "Remote HTTP regression", "provider": provider,
                        "base_url": url, "model": "test-model", "remote_consent": false,
                    }),
                )
                .unwrap();
                let mut model = load(&core, result["id"].as_str().unwrap()).unwrap();
                assert_eq!(model.base_url, url);
                let error = HttpProvider::new(model.clone()).err().unwrap().to_string();
                assert!(error.contains("确认允许发送"), "{error}");
                model.remote_consent = true;
                assert!(HttpProvider::new(model).is_ok());
            }
        }
    }
    #[test]
    fn remote_http_does_not_allow_invalid_urls_or_remote_local_adapter() {
        let mut model: Model = serde_json::from_value(json!({
            "id": "url-validation", "name": "Test", "provider": "openai",
            "base_url": "http://model.example.test", "model": "test-model",
        }))
        .unwrap();
        for url in [
            "ftp://model.example.test",
            "file:///model",
            "http://user:password@model.example.test",
            "http://model.example.test?key=value",
            "http://model.example.test#fragment",
            "model.example.test",
        ] {
            model.base_url = url.to_owned();
            assert!(validate(&model).is_err(), "{url}");
        }
        model.base_url = "http://model.example.test:8787".into();
        model.provider = "wemm".into();
        assert!(validate(&model).is_err());
    }
    #[test]
    fn equal_dimensions_do_not_imply_compatibility() {
        let a = Model {
            id: "a".into(),
            name: "A".into(),
            provider: "wemm".into(),
            base_url: "http://127.0.0.1:8787".into(),
            model: "WeMM-Embedding-2B".into(),
            revision: "v1".into(),
            remote_consent: false,
            fingerprint: "a".into(),
            capabilities: json!({"image":true,"text":true,"image_dimension":2048,"text_dimension":2048}),
            vision_prompt: String::new(),
            vision_max_tokens: default_vision_max_tokens(),
        };
        let mut b = a.clone();
        b.fingerprint = "b".into();
        assert!(compatible(&a, &b).is_err());
        assert!(compatible(&a, &a).is_ok());
    }
}
