use crate::*;
use serde_json::json;
use std::time::{Duration, Instant};

#[test]
fn compatible_api_contract_persists_descriptions_tags_and_embeddings() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for _ in 0..9 {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(15)))
                .unwrap();
            let mut request = Vec::new();
            let mut part = [0u8; 8192];
            let (header_end, length) = loop {
                let n = stream.read(&mut part).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&part[..n]);
                if let Some(pos) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..pos]).to_lowercase();
                    let len: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    break (pos + 4, len);
                }
            };
            while request.len() < header_end + length {
                let n = stream.read(&mut part).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&part[..n]);
            }
            let header = String::from_utf8_lossy(&request[..header_end]);
            let body: serde_json::Value =
                serde_json::from_slice(&request[header_end..header_end + length]).unwrap();
            let response = if header.starts_with("POST /embeddings ") {
                assert!(body["input"].is_string());
                json!({"data":[{"embedding":[0.6,0.8]}]})
            } else {
                assert!(header.starts_with("POST /chat/completions "));
                assert!(body["messages"][0]["content"][1]["image_url"]["url"]
                    .as_str()
                    .unwrap()
                    .starts_with("data:image/jpeg;base64,"));
                let prompt = body["messages"][0]["content"][0]["text"].as_str().unwrap();
                assert!(prompt.contains("重点描述颜色"));
                assert_eq!(body["max_tokens"], 8192);
                assert_eq!(body["stream"], false);
                let content = if prompt.contains("category_ids") {
                    json!({"tags":[{"name":"测试主体","kind":"主体"}],"category_ids":[2,7]})
                        .to_string()
                } else {
                    "契约测试：一张测试图片".to_owned()
                };
                json!({"choices":[{"finish_reason":"stop","message":{"content":[{"type":"text","text":content}]}}]})
            }
            .to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
        }
    });
    let root = tempfile::tempdir().unwrap();
    let core = Arc::new(Core::new(root.path().join("data")).unwrap());
    let pics = root.path().join("pics");
    std::fs::create_dir(&pics).unwrap();
    let path = pics.join("fixture.png");
    image::RgbImage::new(16, 16).save(&path).unwrap();
    let folder = scanner::add_folder(&core, pics.to_str().unwrap()).unwrap();
    scanner::index_file(&core, folder, &path, "test").unwrap();
    models::save(&core,json!({"id":"contract-test","name":"HTTP contract fixture","provider":"openai","base_url":format!("http://{address}"),"model":"fixture","vision_prompt":"重点描述颜色","vision_max_tokens":8192})).unwrap();
    models::test(&core, "contract-test", "text", None).unwrap();
    models::test(
        &core,
        "contract-test",
        "vision",
        Some(path.to_str().unwrap()),
    )
    .unwrap();
    for task in ["description", "tags", "text_embedding"] {
        api::dispatch(
            &core,
            None,
            "assign",
            json!({"task":task,"model_id":"contract-test"}),
        )
        .unwrap();
    }
    for task in ["description", "tags", "description_embedding"] {
        let id = jobs::start(&core, &json!({"kind":"ai","task":task})).unwrap();
        let report = wait(&core, id["id"].as_str().unwrap());
        assert_eq!(report["failed"], 0);
        assert_eq!(report["status"], "completed");
    }
    let detail = library::detail(&core, 1).unwrap();
    assert_eq!(detail["description"], "契约测试：一张测试图片");
    assert_eq!(detail["tags"][0]["name"], "测试主体");
    assert_eq!(detail["categories"].as_array().unwrap().len(), 2);
    assert_eq!(detail["categories"][0]["is_primary"], 1);
    assert_eq!(
        library::search(&core, &json!({"mode":"description","query":"测试图片"})).unwrap()["items"]
            [0]["id"],
        1
    );
    assert_eq!(
        library::list(&core, &json!({"category_id":2})).unwrap()["total"],
        1
    );
    let old_model = models::load(&core, "contract-test").unwrap();
    let mut settings = serde_json::to_value(&old_model).unwrap();
    settings["vision_prompt"] = json!("重点描述颜色和构图");
    models::save(&core, settings).unwrap();
    assert_eq!(
        library::detail(&core, 1).unwrap()["embeddings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    models::test(&core, "contract-test", "vision", path.to_str()).unwrap();
    for task in ["description", "tags"] {
        let id = jobs::start(&core, &json!({"kind":"ai","task":task})).unwrap();
        assert_eq!(wait(&core, id["id"].as_str().unwrap())["failed"], 0);
    }
    let updated_model = models::load(&core, "contract-test").unwrap();
    assert_ne!(
        old_model.vision_fingerprint(),
        updated_model.vision_fingerprint()
    );
    let source: String = core
        .db()
        .unwrap()
        .query_row(
            "SELECT source FROM descriptions WHERE image_id=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(source, updated_model.vision_fingerprint());
    let source: String = core
        .db()
        .unwrap()
        .query_row("SELECT source FROM image_tags WHERE image_id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(source, updated_model.vision_fingerprint());
    library::batch(
        &core,
        &json!({"ids":[1],"action":"description","text":"用户更正"}),
    )
    .unwrap();
    assert_eq!(
        library::detail(&core, 1).unwrap()["embeddings"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    server.join().unwrap();
}

fn wait(core: &Core, id: &str) -> serde_json::Value {
    let start = Instant::now();
    loop {
        let job = db::rows(&core.db().unwrap(), "SELECT * FROM jobs WHERE id=?", [id])
            .unwrap()
            .pop()
            .unwrap();
        if !matches!(
            job["status"].as_str(),
            Some("running" | "queued" | "paused")
        ) {
            return job;
        }
        assert!(start.elapsed() < Duration::from_secs(240), "task timed out");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn cancelled_scan_keeps_originals_and_existing_index() {
    let root = tempfile::tempdir().unwrap();
    let core = Arc::new(Core::new(root.path().join("db")).unwrap());
    let pics = root.path().join("pics");
    std::fs::create_dir(&pics).unwrap();
    for i in 0..8 {
        image::RgbImage::new(60, 40)
            .save(pics.join(format!("{i}.png")))
            .unwrap();
    }
    let folder = scanner::add_folder(&core, pics.to_str().unwrap()).unwrap();
    let task = jobs::start(&core, &json!({"kind":"scan","folder_id":folder})).unwrap();
    let report = wait(&core, task["id"].as_str().unwrap());
    assert_eq!(report["processed"], 8);
    let db = core.db().unwrap();
    db.execute(
        "INSERT INTO jobs(id,kind,status,folder_id) VALUES('cancelled-test','scan','running',?)",
        [folder],
    )
    .unwrap();
    scanner::scan(&core, "cancelled-test", folder, Arc::new(AtomicU8::new(2))).unwrap();
    assert_eq!(library::list(&core, &json!({})).unwrap()["total"], 8);
    let deadline = Instant::now();
    while !core.controls.lock().unwrap().is_empty() {
        assert!(deadline.elapsed() < Duration::from_secs(5));
        std::thread::yield_now();
    }
    api::dispatch(&core, None, "folder_remove", json!({"id":folder})).unwrap();
    assert_eq!(std::fs::read_dir(&pics).unwrap().count(), 8);
    assert_eq!(library::list(&core, &json!({})).unwrap()["total"], 0);
}

#[test]
fn changed_content_invalidates_ai_but_preserves_user_edits() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::new(root.path().join("db")).unwrap();
    let pics = root.path().join("pics");
    std::fs::create_dir(&pics).unwrap();
    let p = pics.join("test.bmp");
    image::RgbImage::from_pixel(10, 10, image::Rgb([255, 0, 0]))
        .save(&p)
        .unwrap();
    let folder = scanner::add_folder(&core, pics.to_str().unwrap()).unwrap();
    scanner::index_file(&core, folder, &p, "first").unwrap();
    library::batch(
        &core,
        &json!({"ids":[1],"action":"description","text":"用户描述"}),
    )
    .unwrap();
    library::batch(
        &core,
        &json!({"ids":[1],"action":"add_tag","name":"用户标签"}),
    )
    .unwrap();
    let db = core.db().unwrap();
    db.execute("INSERT INTO models(id,name,provider,base_url,model,fingerprint) VALUES('m','m','wemm','http://127.0.0.1:8787','m','old')",[]).unwrap();
    db.execute("INSERT INTO embeddings(image_id,model_id,fingerprint,kind,dimension,vector,content_hash) VALUES(1,'m','old','image',1,?,'old')",[models::pack(&[1.])]).unwrap();
    let old = std::fs::metadata(&p).unwrap().modified().unwrap();
    image::RgbImage::from_pixel(10, 10, image::Rgb([0, 255, 0]))
        .save(&p)
        .unwrap();
    std::fs::File::options()
        .write(true)
        .open(&p)
        .unwrap()
        .set_modified(old)
        .unwrap();
    assert!(scanner::index_file(&core, folder, &p, "second").unwrap());
    let d = library::detail(&core, 1).unwrap();
    assert_eq!(d["description"], "用户描述");
    assert_eq!(d["tags"].as_array().unwrap().len(), 1);
    assert_eq!(d["embeddings"].as_array().unwrap().len(), 0);
}

#[test]
fn unavailable_service_is_reported_without_credentials() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::new(root.path().into()).unwrap();
    let m=models::save(&core,json!({"id":"offline-test","name":"offline","provider":"ollama","base_url":"http://127.0.0.1:9","model":"missing"})).unwrap();
    let result = models::test(&core, m["id"].as_str().unwrap(), "connection", None)
        .unwrap_err()
        .to_string();
    assert!(result.contains("无法连接模型服务"));
    let db = core.db().unwrap();
    assert!(
        db::rows(&db, "SELECT test_result FROM models", []).unwrap()[0]["test_result"]
            .as_str()
            .unwrap()
            .contains("无法连接")
    );
}

#[test]
#[ignore = "requires local WeMM service and downloaded public fixtures"]
fn real_wemm_end_to_end() {
    let deployed = models::catalog(
        json!({"id":"","name":"","provider":"wemm","base_url":"http://127.0.0.1:8787","model":""}),
    )
    .unwrap();
    assert_eq!(deployed[0], "WeMM-Embedding-2B");
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let root = project.join("artifacts/e2e-data");
    let core = Arc::new(Core::new(root).unwrap());
    let pictures = project.join("artifacts/fixtures");
    let folder = match scanner::add_folder(&core, pictures.to_str().unwrap()) {
        Ok(id) => id,
        Err(_) => core
            .db()
            .unwrap()
            .query_row(
                "SELECT id FROM folders WHERE path=?",
                [scanner::canonical(pictures.to_str().unwrap())
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()],
                |r| r.get(0),
            )
            .unwrap(),
    };
    let task = jobs::start(&core, &json!({"kind":"scan","folder_id":folder})).unwrap();
    let job = wait(&core, task["id"].as_str().unwrap());
    assert_eq!(job["failed"], 0);
    let deadline = Instant::now();
    while !core.controls.lock().unwrap().is_empty() {
        assert!(deadline.elapsed() < Duration::from_secs(5));
        std::thread::yield_now();
    }
    models::save(&core,json!({"id":"wemm-e2e","name":"本地 WeMM 2B","provider":"wemm","base_url":"http://127.0.0.1:8787","model":"WeMM-Embedding-2B"})).unwrap();
    models::test(&core, "wemm-e2e", "connection", None).unwrap();
    models::test(&core, "wemm-e2e", "text", None).unwrap();
    models::test(
        &core,
        "wemm-e2e",
        "image",
        Some(pictures.join("coffee.png").to_str().unwrap()),
    )
    .unwrap();
    for task in ["image_embedding", "text_embedding"] {
        api::dispatch(
            &core,
            None,
            "assign",
            json!({"task":task,"model_id":"wemm-e2e"}),
        )
        .unwrap();
    }
    let task = jobs::start(&core, &json!({"kind":"ai","task":"image_embedding"})).unwrap();
    let report = wait(&core, task["id"].as_str().unwrap());
    assert_eq!(report["failed"], 0, "{report}");
    let mut results = vec![];
    for (query, expected) in [
        ("一只白色的狗", "dog.jpg"),
        ("穿着宇航服的宇航员", "astronaut.png"),
        ("一杯咖啡", "coffee.png"),
    ] {
        let result =
            library::search(&core, &json!({"mode":"semantic","query":query,"limit":3})).unwrap();
        assert_eq!(result["items"][0]["name"], expected);
        results.push(json!({"query":query,"result":result}));
    }
    let images = library::list(&core, &json!({})).unwrap();
    let dog = images["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == "dog.jpg")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    library::batch(
        &core,
        &json!({"ids":[dog],"action":"add_tag","name":"狗","kind":"主体"}),
    )
    .unwrap();
    library::batch(
        &core,
        &json!({"ids":[dog],"action":"category","category_id":8}),
    )
    .unwrap();
    library::batch(
        &core,
        &json!({"ids":[dog],"action":"description","text":"一只白色的狗站在草地上。"}),
    )
    .unwrap();
    let exact = library::search(
        &core,
        &json!({"mode":"duplicate","path":pictures.join("dog.jpg").to_string_lossy()}),
    )
    .unwrap();
    assert_eq!(exact["items"][0]["relation"], "exact");
    std::fs::write(
        project.join("artifacts/e2e-report.json"),
        serde_json::to_string_pretty(
            &json!({"queries":results,"job":report,"dashboard":library::dashboard(&core).unwrap()}),
        )
        .unwrap(),
    )
    .unwrap();
}
