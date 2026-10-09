BEGIN IMMEDIATE;
CREATE TABLE folders(id INTEGER PRIMARY KEY,path TEXT NOT NULL UNIQUE,added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_scan TEXT);
CREATE TABLE images(
 id INTEGER PRIMARY KEY,folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
 path TEXT NOT NULL UNIQUE,name TEXT NOT NULL,extension TEXT NOT NULL,size INTEGER NOT NULL DEFAULT 0,
 width INTEGER,height INTEGER,ratio REAL,created_at TEXT,modified INTEGER NOT NULL DEFAULT 0,
 hash TEXT,phash TEXT,thumbnail TEXT,exif TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'pending',error TEXT,missing INTEGER NOT NULL DEFAULT 0,
 seen_run TEXT,indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX images_folder ON images(folder_id,missing);
CREATE INDEX images_hash ON images(hash);
CREATE INDEX images_status ON images(status,missing);
CREATE INDEX images_modified ON images(modified);
CREATE TABLE models(id TEXT PRIMARY KEY,name TEXT NOT NULL,provider TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,
 revision TEXT NOT NULL DEFAULT '',remote_consent INTEGER NOT NULL DEFAULT 0,
 fingerprint TEXT NOT NULL,capabilities TEXT NOT NULL DEFAULT '{}',test_result TEXT,last_test TEXT);
CREATE TABLE task_models(task TEXT PRIMARY KEY,model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE);
CREATE TABLE embeddings(image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,kind TEXT NOT NULL,dimension INTEGER NOT NULL,vector BLOB NOT NULL,content_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(image_id,model_id,kind));
CREATE INDEX embeddings_space ON embeddings(fingerprint,kind);
CREATE TABLE descriptions(image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,text TEXT NOT NULL,source TEXT NOT NULL,user_edited INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL,parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,CHECK(id<>parent_id));
CREATE UNIQUE INDEX categories_unique ON categories(COALESCE(parent_id,0),name);
CREATE TABLE image_categories(image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,is_primary INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'user',PRIMARY KEY(image_id,category_id));
CREATE UNIQUE INDEX primary_category ON image_categories(image_id) WHERE is_primary=1;
CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT '主题',UNIQUE(name,kind));
CREATE TABLE image_tags(image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,source TEXT NOT NULL DEFAULT 'user',confirmed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(image_id,tag_id));
CREATE TABLE jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,task TEXT,
 status TEXT NOT NULL,processed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,
 message TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,elapsed_ms INTEGER NOT NULL DEFAULT 0);
CREATE TABLE job_items(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(job_id,image_id));
CREATE TABLE errors(id INTEGER PRIMARY KEY,job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,path TEXT,message TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO settings VALUES('model_concurrency','1');
INSERT INTO settings VALUES('read_exif','true');
INSERT INTO categories(name,parent_id) VALUES('人物与肖像',NULL),('动物与自然',NULL),('游戏与数字内容',NULL),('文档与截图',NULL),('设计与创作',NULL),('日常生活',NULL);
INSERT INTO categories(name,parent_id) VALUES('猫',2),('狗',2),('风景',2),('游戏截图',3),('二次元插画',3),('聊天截图',4),('软件界面',4),('海报',5),('食物',6),('建筑',6);
PRAGMA user_version=1;
COMMIT;
