use crate::{
    db,
    models::{self, ModelProvider},
    scanner, Core,
};
use anyhow::{bail, Context, Result};
use rusqlite::{params, params_from_iter, types::Value as SqlValue};
use serde_json::{json, Value};
use std::{path::Path, time::Instant};

pub fn filters(a: &Value) -> (String, Vec<SqlValue>) {
    let mut sql = "i.missing=0".to_string();
    let mut values = vec![];
    for (key,expr) in [("folder_id","i.folder_id=?"),("category_id","EXISTS(SELECT 1 FROM image_categories ic WHERE ic.image_id=i.id AND ic.category_id IN (WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id=sub.id) SELECT id FROM sub))"),("tag_id","EXISTS(SELECT 1 FROM image_tags it WHERE it.image_id=i.id AND it.tag_id=?)")]{
        if let Some(n)=a[key].as_i64().filter(|n|*n>0){sql.push_str(&format!(" AND {expr}"));values.push(n.into());}
    }
    for (key, expr) in [
        ("extension", "i.extension=?"),
        ("status", "i.status=?"),
        ("from", "date(i.indexed_at)>=?"),
        ("to", "date(i.indexed_at)<=?"),
    ] {
        if let Some(s) = a[key].as_str().filter(|s| !s.is_empty()) {
            sql.push_str(&format!(" AND {expr}"));
            values.push(s.to_string().into());
        }
    }
    if let Some(q) = a["query"].as_str().filter(|s| !s.is_empty()) {
        sql.push_str(" AND (i.name LIKE ? ESCAPE '!' OR EXISTS(SELECT 1 FROM descriptions d WHERE d.image_id=i.id AND d.text LIKE ? ESCAPE '!') OR EXISTS(SELECT 1 FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE it.image_id=i.id AND t.name LIKE ? ESCAPE '!'))");
        let q = format!(
            "%{}%",
            q.replace('!', "!!").replace('%', "!%").replace('_', "!_")
        );
        values.extend([q.clone().into(), q.clone().into(), q.into()]);
    }
    if a["duplicates"] == true {
        sql.push_str(" AND i.hash IN(SELECT hash FROM images WHERE missing=0 AND status='ready' AND hash IS NOT NULL GROUP BY hash HAVING count(*)>1)");
    }
    (sql, values)
}
pub const SUMMARY:&str="i.id,i.folder_id,i.path,i.name,i.extension,i.size,i.width,i.height,i.thumbnail,i.status,i.error,i.hash,i.phash,i.indexed_at,(SELECT group_concat(t.name, ' · ') FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE it.image_id=i.id) AS tags,(SELECT c.name FROM image_categories ic JOIN categories c ON c.id=ic.category_id WHERE ic.image_id=i.id AND ic.is_primary=1) AS category";
pub fn list(core: &Core, args: &Value) -> Result<Value> {
    let db = core.db()?;
    let (filter, mut values) = filters(args);
    let total: i64 = db.query_row(
        &format!("SELECT count(*) FROM images i WHERE {filter}"),
        params_from_iter(&values),
        |r| r.get(0),
    )?;
    let sort = match args["sort"].as_str() {
        Some("name") => "i.name COLLATE NOCASE",
        Some("size") => "i.size DESC",
        Some("oldest") => "i.id ASC",
        _ => "i.id DESC",
    };
    let page = args["page"].as_i64().unwrap_or(0).max(0);
    let limit = args["limit"].as_i64().unwrap_or(120).clamp(1, 240);
    values.push(limit.into());
    values.push((page * limit).into());
    let items = db::rows(
        &db,
        &format!("SELECT {SUMMARY} FROM images i WHERE {filter} ORDER BY {sort} LIMIT ? OFFSET ?"),
        params_from_iter(&values),
    )?;
    Ok(json!({"items":items,"total":total,"page":page,"limit":limit}))
}
pub fn detail(core: &Core, id: i64) -> Result<Value> {
    let db = core.db()?;
    let mut item=db::rows(&db,"SELECT i.*,d.text AS description,d.user_edited AS description_edited FROM images i LEFT JOIN descriptions d ON d.image_id=i.id WHERE i.id=?",[id])?.pop().context("图片不存在")?;
    item["tags"]=json!(db::rows(&db,"SELECT t.*,it.source,it.confirmed,it.created_at FROM tags t JOIN image_tags it ON it.tag_id=t.id WHERE it.image_id=?",[id])?);
    item["categories"]=json!(db::rows(&db,"SELECT c.*,ic.is_primary,ic.source FROM categories c JOIN image_categories ic ON ic.category_id=c.id WHERE ic.image_id=? ORDER BY ic.is_primary DESC",[id])?);
    item["embeddings"]=json!(db::rows(&db,"SELECT e.kind,e.dimension,e.created_at,m.name,e.fingerprint=m.fingerprint AS current FROM embeddings e JOIN models m ON m.id=e.model_id WHERE e.image_id=?",[id])?);
    Ok(item)
}
pub fn taxonomy(core: &Core) -> Result<Value> {
    let db = core.db()?;
    Ok(json!({
        "categories":db::rows(&db,"SELECT c.*,(SELECT count(*) FROM image_categories ic JOIN images i ON i.id=ic.image_id WHERE ic.category_id=c.id AND i.missing=0) AS count FROM categories c ORDER BY c.name",[])?,
        "tags":db::rows(&db,"SELECT t.*,(SELECT count(*) FROM image_tags it JOIN images i ON i.id=it.image_id WHERE it.tag_id=t.id AND i.missing=0) AS count FROM tags t ORDER BY count DESC,t.name",[])?
    }))
}
pub fn category(core: &Core, args: &Value) -> Result<Value> {
    let mut db = core.db()?;
    let tx = db.transaction()?;
    let action = args["action"].as_str().unwrap_or("save");
    let id = args["id"].as_i64().unwrap_or(0);
    match action {
        "delete" => {
            tx.execute("DELETE FROM categories WHERE id=?", [id])?;
        }
        "merge" => {
            let target = args["target"].as_i64().context("请选择合并目标")?;
            if id == target {
                bail!("不能合并到自身")
            }
            let descendant:i64=tx.query_row("WITH RECURSIVE sub(id) AS(SELECT ?1 UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id=sub.id) SELECT count(*) FROM sub WHERE id=?2",params![id,target],|r|r.get(0))?;
            if descendant > 0 {
                bail!("不能合并到子分类")
            }
            tx.execute("INSERT INTO image_categories(image_id,category_id,is_primary,source) SELECT image_id,?2,0,'user' FROM image_categories WHERE category_id=?1 ON CONFLICT(image_id,category_id) DO NOTHING",params![id,target])?;
            let primary_images = db::rows(
                &tx,
                "SELECT image_id FROM image_categories WHERE category_id=? AND is_primary=1",
                [id],
            )?;
            tx.execute(
                "UPDATE image_categories SET is_primary=0 WHERE category_id=?",
                [id],
            )?;
            for image in primary_images {
                tx.execute(
                    "UPDATE image_categories SET is_primary=1 WHERE image_id=? AND category_id=?",
                    params![image["image_id"].as_i64(), target],
                )?;
            }
            tx.execute(
                "UPDATE categories SET parent_id=? WHERE parent_id=?",
                params![target, id],
            )?;
            tx.execute("DELETE FROM categories WHERE id=?", [id])?;
        }
        "save" => {
            let name = args["name"].as_str().unwrap_or("").trim();
            if name.is_empty() {
                bail!("分类名称不能为空")
            };
            let parent = args["parent_id"].as_i64().filter(|n| *n > 0);
            if let Some(parent) = parent {
                let count:i64=tx.query_row("WITH RECURSIVE sub(id) AS(SELECT ?1 UNION ALL SELECT c.id FROM categories c JOIN sub ON c.parent_id=sub.id) SELECT count(*) FROM sub WHERE id=?2",params![id,parent],|r|r.get(0))?;
                if count > 0 {
                    bail!("分类不能成为自身或子分类的子节点")
                }
            }
            if id > 0 {
                tx.execute(
                    "UPDATE categories SET name=?,parent_id=? WHERE id=?",
                    params![name, parent, id],
                )?;
            } else {
                tx.execute(
                    "INSERT INTO categories(name,parent_id) VALUES(?,?)",
                    params![name, parent],
                )?;
            }
        }
        _ => bail!("未知分类操作"),
    };
    tx.commit()?;
    Ok(json!(true))
}
pub fn batch(core: &Core, args: &Value) -> Result<Value> {
    let ids: Vec<i64> = serde_json::from_value(args["ids"].clone())?;
    if ids.is_empty() || ids.len() > 1000 {
        bail!("请选择 1–1000 张图片")
    }
    let action = args["action"].as_str().unwrap_or("");
    let mut db = core.db()?;
    let tx = db.transaction()?;
    for id in ids {
        match action {
            "add_tag" => {
                let name = args["name"].as_str().unwrap_or("").trim();
                let kind = args["kind"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("主题");
                if name.is_empty() {
                    bail!("标签不能为空")
                }
                tx.execute(
                    "INSERT INTO tags(name,kind) VALUES(?,?) ON CONFLICT DO NOTHING",
                    params![name, kind],
                )?;
                tx.execute("INSERT INTO image_tags(image_id,tag_id,source,confirmed) VALUES(?,(SELECT id FROM tags WHERE name=? AND kind=?),'user',1) ON CONFLICT(image_id,tag_id) DO UPDATE SET source='user',confirmed=1",params![id,name,kind])?;
            }
            "remove_tag" => {
                tx.execute(
                    "DELETE FROM image_tags WHERE image_id=? AND tag_id=?",
                    params![id, args["tag_id"].as_i64()],
                )?;
            }
            "category" => {
                let cat = args["category_id"].as_i64().context("请选择分类")?;
                let primary = args["primary"].as_bool().unwrap_or(true);
                if primary {
                    tx.execute(
                        "UPDATE image_categories SET is_primary=0 WHERE image_id=?",
                        [id],
                    )?;
                }
                tx.execute("INSERT INTO image_categories(image_id,category_id,is_primary,source) VALUES(?,?,?,'user') ON CONFLICT(image_id,category_id) DO UPDATE SET is_primary=excluded.is_primary,source='user'",params![id,cat,primary])?;
            }
            "remove_category" => {
                tx.execute(
                    "DELETE FROM image_categories WHERE image_id=? AND category_id=?",
                    params![id, args["category_id"].as_i64()],
                )?;
            }
            "description" => {
                let text = args["text"].as_str().unwrap_or("");
                tx.execute("INSERT INTO descriptions(image_id,text,source,user_edited) VALUES(?,?,'user',1) ON CONFLICT(image_id) DO UPDATE SET text=excluded.text,source='user',user_edited=1,created_at=CURRENT_TIMESTAMP",params![id,text])?;
                tx.execute(
                    "DELETE FROM embeddings WHERE image_id=? AND kind='description'",
                    [id],
                )?;
            }
            _ => bail!("未知批量操作"),
        }
    }
    tx.commit()?;
    Ok(json!(true))
}
pub fn dashboard(core: &Core) -> Result<Value> {
    let db = core.db()?;
    let metrics=db::rows(&db,"SELECT count(*) AS total,coalesce(sum(status='ready'),0) AS indexed,coalesce(sum(status='pending'),0) AS pending,coalesce(sum(status='failed'),0) AS failed,coalesce(sum(size),0) AS bytes,coalesce(sum(EXISTS(SELECT 1 FROM image_categories c WHERE c.image_id=i.id)),0) AS classified,coalesce(sum(EXISTS(SELECT 1 FROM image_tags t WHERE t.image_id=i.id)),0) AS tagged,coalesce(sum(EXISTS(SELECT 1 FROM embeddings e JOIN models m ON m.id=e.model_id WHERE e.image_id=i.id AND e.fingerprint=m.fingerprint AND e.content_hash=i.hash)),0) AS embedded FROM images i WHERE missing=0",[])?.pop();
    Ok(json!({"metrics":metrics,
        "duplicates":db::rows(&db,"SELECT coalesce(sum(n-1),0) AS count FROM(SELECT count(*) n FROM images WHERE missing=0 AND status='ready' AND hash IS NOT NULL GROUP BY hash HAVING count(*)>1)",[])?.pop(),
        "trend":db::rows(&db,"SELECT date(indexed_at) AS name,count(*) AS value FROM images WHERE missing=0 GROUP BY date(indexed_at) ORDER BY name DESC LIMIT 30",[])?.into_iter().rev().collect::<Vec<_>>(),
        "formats":db::rows(&db,"SELECT upper(extension) AS name,extension AS filter,count(*) AS value FROM images WHERE missing=0 GROUP BY extension ORDER BY value DESC",[])?,
        "categories":db::rows(&db,"SELECT c.id,c.name,count(*) AS value FROM image_categories ic JOIN categories c ON c.id=ic.category_id JOIN images i ON i.id=ic.image_id WHERE i.missing=0 GROUP BY c.id ORDER BY value DESC LIMIT 12",[])?,
        "tags":db::rows(&db,"SELECT t.id,t.name,count(*) AS value FROM image_tags it JOIN tags t ON t.id=it.tag_id JOIN images i ON i.id=it.image_id WHERE i.missing=0 GROUP BY t.id ORDER BY value DESC LIMIT 10",[])?,
        "sizes":db::rows(&db,"SELECT CASE WHEN width*height<1000000 THEN '< 1 MP' WHEN width*height<4000000 THEN '1–4 MP' WHEN width*height<12000000 THEN '4–12 MP' ELSE '≥ 12 MP' END AS name,count(*) AS value FROM images WHERE missing=0 AND status='ready' GROUP BY name",[])?,
        "states":db::rows(&db,"SELECT status AS name,count(*) AS value FROM images WHERE missing=0 GROUP BY status",[])?,
        "recent":db::rows(&db,&format!("SELECT {SUMMARY} FROM images i WHERE missing=0 AND status='ready' ORDER BY id DESC LIMIT 6"),[])?
    }))
}

pub fn search(core: &Core, args: &Value) -> Result<Value> {
    let start = Instant::now();
    let mode = args["mode"].as_str().unwrap_or("semantic");
    let limit = args["limit"].as_u64().unwrap_or(60).clamp(1, 240) as usize;
    let db = core.db()?;
    let mut query_path = args["path"].as_str().map(str::to_owned);
    if let Some(id) = args["image_id"].as_i64() {
        query_path = Some(db.query_row(
            "SELECT path FROM images WHERE id=? AND missing=0 AND status='ready'",
            [id],
            |r| r.get(0),
        )?);
    }
    let mut filters_args = args.clone();
    filters_args["query"] = Value::Null;
    let (filter, values) = filters(&filters_args);
    let mut scored: Vec<(i64, f32, String)> = vec![];
    if mode == "duplicate" || mode == "visual" {
        let path = Path::new(query_path.as_deref().context("请选择查询图片")?);
        let hash = scanner::file_hash(path)?;
        let phash = scanner::dhash(&scanner::decode(path)?);
        let mut stmt = db.prepare(&format!(
            "SELECT i.id,i.hash,i.phash FROM images i WHERE {filter} AND i.status='ready'"
        ))?;
        let mut rows = stmt.query(params_from_iter(&values))?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let h: String = row.get(1)?;
            let ph: String = row.get(2)?;
            let distance = scanner::hamming(&phash, &ph);
            if h == hash {
                scored.push((id, 1., "exact".into()));
            } else if mode == "visual" && distance <= 12 {
                scored.push((id, 1. - distance as f32 / 64., "perceptual".into()));
            }
        }
    } else {
        let (model, kind, query) = if mode == "image" {
            let model = models::assigned(core, "image_embedding")?;
            models::require(&model, "image")?;
            let p = models::HttpProvider::new(model.clone())?;
            let q =
                p.image_embedding(Path::new(query_path.as_deref().context("请选择查询图片")?))?;
            (model, "image", q)
        } else if mode == "description" {
            let model = models::assigned(core, "text_embedding")?;
            models::require(&model, "text")?;
            let p = models::HttpProvider::new(model.clone())?;
            let text = args["query"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .context("请输入查询文本")?;
            let q = p.text_embedding(text)?;
            (model, "description", q)
        } else if mode == "semantic" {
            let model = models::assigned(core, "image_embedding")?;
            let text_model = models::assigned(core, "text_embedding")?;
            models::compatible(&model, &text_model)?;
            let p = models::HttpProvider::new(text_model)?;
            let text = args["query"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .context("请输入查询文本")?;
            let q = p.text_embedding(text)?;
            (model, "image", q)
        } else {
            bail!("未知搜索模式")
        };
        let mut params = values;
        params.push(model.fingerprint.into());
        params.push(kind.to_string().into());
        let mut stmt=db.prepare(&format!("SELECT i.id,e.dimension,e.vector FROM embeddings e JOIN images i ON i.id=e.image_id WHERE {filter} AND i.status='ready' AND e.fingerprint=? AND e.kind=? AND e.content_hash=i.hash"))?;
        let mut rows = stmt.query(params_from_iter(&params))?;
        let mut found = false;
        while let Some(row) = rows.next()? {
            found = true;
            let dim: usize = row.get(1)?;
            if dim != query.len() {
                bail!("索引与查询维度不一致，请重新测试模型并重建该模型索引")
            }
            let id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(2)?;
            let vector = models::unpack(&blob)?;
            let score = models::cosine(&query, &vector)?;
            scored.push((
                id,
                score,
                if kind == "description" {
                    "description"
                } else {
                    "semantic"
                }
                .into(),
            ));
            if scored.len() > limit * 2 {
                scored.sort_by(|a, b| b.1.total_cmp(&a.1));
                scored.truncate(limit);
            }
        }
        if !found {
            bail!("当前筛选范围内没有兼容的向量索引，请先运行相应 AI 索引任务")
        }
    }
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored.dedup_by_key(|v| v.0);
    if let Some(id) = args["image_id"].as_i64() {
        scored.retain(|v| v.0 != id);
    }
    scored.truncate(limit);
    let mut items = vec![];
    for (id, score, relation) in scored {
        let mut item = db::rows(
            &db,
            &format!("SELECT {SUMMARY} FROM images i WHERE id=?"),
            [id],
        )?
        .pop()
        .unwrap();
        item["score"] = json!(score);
        item["relation"] = json!(relation);
        items.push(item);
    }
    Ok(
        json!({"items":items,"elapsed_ms":start.elapsed().as_millis(),"mode":mode,"query_path":query_path}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hierarchy_rejects_cycles_and_multi_tag_counts_once() {
        let d = tempfile::tempdir().unwrap();
        let core = Core::new(d.path().into()).unwrap();
        assert!(category(&core, &json!({"id":2,"name":"动物","parent_id":7})).is_err());
        let db = core.db().unwrap();
        db.execute("INSERT INTO folders(id,path) VALUES(1,'test')", [])
            .unwrap();
        db.execute("INSERT INTO images(id,folder_id,path,name,extension,status) VALUES(1,1,'a','a','png','ready')",[]).unwrap();
        for tag in ["猫", "室内"] {
            batch(&core, &json!({"ids":[1],"action":"add_tag","name":tag})).unwrap();
        }
        let stats = dashboard(&core).unwrap();
        assert_eq!(stats["metrics"]["tagged"], 1);
        assert_eq!(stats["metrics"]["total"], 1);
        assert_eq!(list(&core, &json!({"query":"%"})).unwrap()["total"], 0);
        batch(
            &core,
            &json!({"ids":[1],"action":"category","category_id":7}),
        )
        .unwrap();
        category(&core, &json!({"id":7,"target":8,"action":"merge"})).unwrap();
        let image = detail(&core, 1).unwrap();
        assert_eq!(image["categories"][0]["id"], 8);
        assert_eq!(image["categories"][0]["is_primary"], 1);
    }
}
