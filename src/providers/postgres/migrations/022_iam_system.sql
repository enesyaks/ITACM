-- IAM (Identity & Access Management) — Granüler izin sistemi
-- 
-- Bu migration, mevcut RBAC (Owner/Admin/Helpdesk/Viewer) yapısının üzerine
-- granüler, kaynak-tabanlı erişim kontrolü ekler.
--
-- Temel kavramlar:
--   permission_groups  → İzin grupları (örn: "IT Admin", "Finance Viewer", "Helpdesk Limited")
--   permission_entries → Grup bazında kaynak + aksiyon + kısıtlama tanımları
--   users.permission_group_id → Kullanıcının hangi gruba bağlı olduğu
--   users.custom_constraints  → Kullanıcıya özel ek kısıtlamalar (departman, lokasyon, limit vb.)

BEGIN;

-- ============================================================
-- 1. İZİN GRUPLARI
-- ============================================================
CREATE TABLE IF NOT EXISTS permission_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  is_system     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. İZİN KAYITLARI (her grup için hangi kaynaklara ne yapabileceği)
-- ============================================================
CREATE TABLE IF NOT EXISTS permission_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  resource        TEXT NOT NULL,
  action          TEXT NOT NULL,
  constraint_type TEXT DEFAULT NULL,
  constraint_value JSONB DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, resource, action, constraint_type)
);

CREATE INDEX IF NOT EXISTS idx_perm_entries_group ON permission_entries (group_id);
CREATE INDEX IF NOT EXISTS idx_perm_entries_resource ON permission_entries (resource, action);

-- resource değerleri
--   'asset', 'license', 'employee', 'contract', 'provider', 'line', 'consumable',
--   'maintenance', 'stock_count', 'report', 'audit', 'dashboard', 'settings',
--   'user_management', 'integration', 'document', 'catalog', 'handover', 'onboarding'
--
-- action değerleri
--   'read', 'create', 'update', 'delete', 'assign', 'unassign', 'export',
--   'import', 'manage', 'approve', 'view_confidential'
--
-- constraint_type değerleri (opsiyonel)
--   'department'     → Sadece belirli departmanlar (constraint_value: ["IT", "Finance"])
--   'location'       → Sadece belirli lokasyonlar (constraint_value: ["Istanbul"])
--   'category'       → Sadece belirli kategoriler (constraint_value: ["Laptop", "Desktop"])
--   'cost_limit'     → Maksimum maliyet limiti (constraint_value: 50000)
--   'seats_limit'    → Maksimum lisans koltuğu (constraint_value: 100)
--   'max_assets'     → Maksimum cihaz sayısı (constraint_value: 50)
--   'owner_only'     → Sadece kendi oluşturduğu kayıtlar (constraint_value: true)

-- ============================================================
-- 3. KULLANICI-İZİN GRUBU İLİŞKİSİ
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_group_id UUID REFERENCES permission_groups(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_constraints JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_perm_group ON users (permission_group_id)
  WHERE permission_group_id IS NOT NULL;

-- ============================================================
-- 4. SİSTEM (BUILT-IN) İZİN GRUPLARI
-- ============================================================

-- Owner: Her şeye tam erişim
INSERT INTO permission_groups (id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Owner',
   'Full system access — all resources, all actions, no constraints (built-in)', true)
ON CONFLICT (name) DO NOTHING;

-- Admin: Neredeyse her şey, Owner kontrolleri hariç
INSERT INTO permission_groups (id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Admin',
   'Full operational access — cannot manage Owner role or delete system groups (built-in)', true)
ON CONFLICT (name) DO NOTHING;

-- Helpdesk: Operasyonel erişim, sınırlı yönetim
INSERT INTO permission_groups (id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000003', 'Helpdesk',
   'Operational access — can create/update/assign assets, employees, licenses (built-in)', true)
ON CONFLICT (name) DO NOTHING;

-- Viewer: Sadece okuma
INSERT INTO permission_groups (id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000004', 'Viewer',
   'Read-only access — dashboard, asset list, employee list, reports (built-in)', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 5. SİSTEM İZİN KAYITLARI (built-in permission entries)
-- ============================================================

-- Owner permissions (her şey)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, r.resource, a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (
  VALUES ('asset'), ('license'), ('employee'), ('contract'), ('provider'),
         ('line'), ('consumable'), ('maintenance'), ('stock_count'), ('report'),
         ('audit'), ('dashboard'), ('settings'), ('user_management'),
         ('integration'), ('document'), ('catalog'), ('handover'), ('onboarding')
) AS r(resource)
CROSS JOIN (
  VALUES ('read'), ('create'), ('update'), ('delete'), ('assign'), ('unassign'),
         ('export'), ('import'), ('manage'), ('approve'), ('view_confidential')
) AS a(action)
WHERE g.name = 'Owner'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = r.resource AND pe.action = a.action
  );

-- Admin permissions (Owner olmayan her şey)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, r.resource, a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (
  VALUES ('asset'), ('license'), ('employee'), ('contract'), ('provider'),
         ('line'), ('consumable'), ('maintenance'), ('stock_count'), ('report'),
         ('audit'), ('dashboard'), ('settings'), ('integration'),
         ('document'), ('catalog'), ('handover'), ('onboarding')
) AS r(resource)
CROSS JOIN (
  VALUES ('read'), ('create'), ('update'), ('delete'), ('assign'), ('unassign'),
         ('export'), ('import'), ('manage'), ('approve'), ('view_confidential')
) AS a(action)
WHERE g.name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = r.resource AND pe.action = a.action
  );

-- Admin'in user_management sınırlı (Owner rolünü yönetemez)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'user_management', a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('read'), ('create'), ('update')) AS a(action)
WHERE g.name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'user_management' AND pe.action = a.action
  );

-- Helpdesk permissions
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, r.resource, a.action, NULL, NULL
FROM permission_groups g
CROSS JOIN (
  VALUES ('asset'), ('license'), ('employee'), ('line'), ('consumable'),
         ('maintenance'), ('stock_count'), ('handover'), ('onboarding'),
         ('catalog'), ('dashboard')
) AS r(resource)
CROSS JOIN (
  VALUES ('read'), ('create'), ('update'), ('assign'), ('unassign')
) AS a(action)
WHERE g.name = 'Helpdesk'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = r.resource AND pe.action = a.action
  );

-- Helpdesk: provider/contract sadece okuma
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, r.resource, 'read', NULL, NULL
FROM permission_groups g
CROSS JOIN (VALUES ('provider'), ('contract')) AS r(resource)
WHERE g.name = 'Helpdesk'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = r.resource AND pe.action = 'read'
  );

-- Helpdesk: rapor okuma
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, 'report', 'read', NULL, NULL
FROM permission_groups g
WHERE g.name = 'Helpdesk'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = 'report' AND pe.action = 'read'
  );

-- Viewer permissions (sadece okuma)
INSERT INTO permission_entries (group_id, resource, action, constraint_type, constraint_value)
SELECT g.id, r.resource, 'read', NULL, NULL
FROM permission_groups g
CROSS JOIN (
  VALUES ('asset'), ('employee'), ('license'), ('provider'), ('contract'),
         ('line'), ('consumable'), ('report'), ('dashboard'), ('catalog')
) AS r(resource)
WHERE g.name = 'Viewer'
  AND NOT EXISTS (
    SELECT 1 FROM permission_entries pe
    WHERE pe.group_id = g.id AND pe.resource = r.resource AND pe.action = 'read'
  );

-- ============================================================
-- 6. MEVCUT KULLANICILARI İZİN GRUPLARINA ATA
-- ============================================================
-- Rolü 'Owner' olan kullanıcıları Owner grubuna ata
UPDATE users u
SET permission_group_id = '00000000-0000-0000-0000-000000000001'
WHERE u.role = 'Owner' AND u.permission_group_id IS NULL;

-- Rolü 'Admin' olanları Admin grubuna ata
UPDATE users u
SET permission_group_id = '00000000-0000-0000-0000-000000000002'
WHERE u.role = 'Admin' AND u.permission_group_id IS NULL;

-- Rolü 'Helpdesk' olanları Helpdesk grubuna ata
UPDATE users u
SET permission_group_id = '00000000-0000-0000-0000-000000000003'
WHERE u.role = 'Helpdesk' AND u.permission_group_id IS NULL;

-- Rolü 'Viewer' olanları Viewer grubuna ata
UPDATE users u
SET permission_group_id = '00000000-0000-0000-0000-000000000004'
WHERE u.role = 'Viewer' AND u.permission_group_id IS NULL;

COMMIT;
