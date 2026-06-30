create table if not exists "role" (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permission (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null,
  resource text not null,
  action text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permission_type_check check (type in ('page', 'menu', 'button', 'api', 'data'))
);

create table if not exists user_role (
  user_id uuid not null references app_user(id) on delete cascade,
  role_id uuid not null references "role"(id) on delete cascade,
  assigned_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists role_permission (
  role_id uuid not null references "role"(id) on delete cascade,
  permission_id uuid not null references permission(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists department (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_id uuid references department(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menu_permission (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  path text not null,
  permission_code text not null,
  sort_order int not null default 0,
  parent_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_acl (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_document(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  actions jsonb not null default '[]'::jsonb,
  effect text not null default 'allow',
  created_at timestamptz not null default now(),
  constraint document_acl_subject_type_check check (subject_type in ('user', 'role', 'department')),
  constraint document_acl_effect_check check (effect in ('allow', 'deny'))
);

create table if not exists knowledge_base_acl (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid not null references knowledge_base(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  actions jsonb not null default '[]'::jsonb,
  effect text not null default 'allow',
  created_at timestamptz not null default now(),
  constraint knowledge_base_acl_subject_type_check check (subject_type in ('user', 'role', 'department')),
  constraint knowledge_base_acl_effect_check check (effect in ('allow', 'deny'))
);

alter table if exists knowledge_chunk
  add column if not exists allowed_user_ids text[],
  add column if not exists allowed_role_ids text[],
  add column if not exists allowed_department_ids text[],
  add column if not exists security_level int not null default 0,
  add column if not exists acl_version int not null default 1;

create index if not exists idx_user_role_user_id on user_role(user_id);
create index if not exists idx_user_role_role_id on user_role(role_id);
create index if not exists idx_role_permission_role_id on role_permission(role_id);
create index if not exists idx_role_permission_permission_id on role_permission(permission_id);
create index if not exists idx_permission_code on permission(code);
create index if not exists idx_menu_permission_permission_code on menu_permission(permission_code);
create index if not exists idx_document_acl_document_id on document_acl(document_id);
create index if not exists idx_document_acl_subject on document_acl(subject_type, subject_id);
create index if not exists idx_knowledge_base_acl_kb_id on knowledge_base_acl(knowledge_base_id);
create index if not exists idx_knowledge_base_acl_subject on knowledge_base_acl(subject_type, subject_id);
create index if not exists idx_knowledge_chunk_acl_version on knowledge_chunk(acl_version);
create index if not exists idx_knowledge_chunk_security_level on knowledge_chunk(security_level);

insert into "role" (code, name, description, builtin)
values
  ('admin', '管理员', '拥有系统管理权限', true),
  ('user', '普通用户', '拥有知识库基础使用权限', true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  builtin = excluded.builtin,
  updated_at = now();

insert into permission (code, name, type, resource, action, description)
values
  ('dashboard:view', '查看首页大盘', 'page', 'dashboard', 'view', '允许查看首页大盘'),
  ('documents:view', '查看文档', 'page', 'documents', 'view', '允许查看文档管理'),
  ('documents:upload', '上传文档', 'button', 'documents', 'upload', '允许上传文档'),
  ('documents:delete', '删除文档', 'button', 'documents', 'delete', '允许删除文档'),
  ('documents:retry', '重试文档处理', 'button', 'documents', 'retry', '允许重试失败文档'),
  ('documents:archive', '归档文档', 'button', 'documents', 'archive', '允许归档文档版本'),
  ('documents:version:set-current', '设置当前版本', 'button', 'documents', 'version:set-current', '允许设置文档当前版本'),
  ('search:view', '智能搜索', 'page', 'search', 'view', '允许使用智能搜索'),
  ('chat:view', 'AI 问答', 'page', 'chat', 'view', '允许使用 AI 问答'),
  ('eval:view', '查看问答验证', 'page', 'eval', 'view', '允许查看问答验证用例'),
  ('eval:run', '运行问答验证', 'button', 'eval', 'run', '允许运行问答验证'),
  ('api-key:manage', '管理 API Key', 'button', 'api-key', 'manage', '允许管理个人 API Key'),
  ('memory:manage', '管理记忆', 'button', 'memory', 'manage', '允许管理个人记忆'),
  ('system:role-manage', '管理角色权限', 'api', 'system', 'role-manage', '允许管理角色和权限')
on conflict (code) do update set
  name = excluded.name,
  type = excluded.type,
  resource = excluded.resource,
  action = excluded.action,
  description = excluded.description,
  updated_at = now();

insert into menu_permission (code, name, path, permission_code, sort_order, parent_code)
values
  ('dashboard', '首页大盘', '/dashboard', 'dashboard:view', 10, null),
  ('documents', '文档管理', '/documents', 'documents:view', 20, null),
  ('search', '智能搜索', '/search', 'search:view', 30, null),
  ('chat', 'AI 问答', '/chat', 'chat:view', 40, null),
  ('eval', '问答验证', '/kb', 'eval:view', 50, null),
  ('profile', '个人中心', '/profile', 'api-key:manage', 60, null),
  ('system', '系统管理', '/system/roles', 'system:role-manage', 90, null)
on conflict (code) do update set
  name = excluded.name,
  path = excluded.path,
  permission_code = excluded.permission_code,
  sort_order = excluded.sort_order,
  parent_code = excluded.parent_code,
  updated_at = now();

insert into role_permission (role_id, permission_id)
select r.id, p.id
from "role" r
cross join permission p
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

insert into role_permission (role_id, permission_id)
select r.id, p.id
from "role" r
join permission p on p.code in (
  'dashboard:view',
  'documents:view',
  'documents:upload',
  'documents:retry',
  'search:view',
  'chat:view',
  'eval:view',
  'eval:run',
  'api-key:manage',
  'memory:manage'
)
where r.code = 'user'
on conflict (role_id, permission_id) do nothing;
