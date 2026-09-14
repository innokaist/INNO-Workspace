CREATE INDEX IF NOT EXISTS tasks_status_updated ON tasks(json_extract(body,'$.status'), updated_at);
