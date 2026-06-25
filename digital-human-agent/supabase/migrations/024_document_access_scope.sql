alter table if exists app_user
  add column if not exists department text;

alter table if exists knowledge_document
  add column if not exists owner_id uuid;

create index if not exists idx_app_user_department
  on app_user(department);

create index if not exists idx_knowledge_document_owner_id
  on knowledge_document(owner_id);

create index if not exists idx_knowledge_document_access_scope
  on knowledge_document(visibility, department, owner_id);
