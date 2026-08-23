-- ITIL-aligned default service-request catalog. Seeded once, idempotent by name
-- (never duplicates or overwrites an admin's own templates). Approval chains use
-- org-resolved levels (manager / department), so they only actually gate a
-- request when the approval workflow is switched on. Admins can rename, retarget,
-- add a fixed approver / amount threshold, disable, or delete any of these.
INSERT INTO request_templates (name, category, description, approval_levels, enabled, sort_order)
SELECT v.name, v.category, v.description, v.approval_levels::jsonb, true, v.sort_order
FROM (VALUES
  ('Yeni donanım talebi',        'Donanım',   'Dizüstü, monitör, klavye/mouse gibi yeni donanım talebi.',            '["manager"]',              10),
  ('Yazılım / lisans talebi',    'Yazılım',   'Yeni yazılım kurulumu veya lisans ataması.',                          '["manager"]',              20),
  ('Sistem / uygulama erişimi',  'Erişim',    'Bir sisteme, uygulamaya veya paylaşımlı klasöre erişim.',             '["manager"]',              30),
  ('VPN / uzaktan erişim',       'Erişim',    'Şirket ağına uzaktan (VPN) erişim talebi.',                           '["manager","department"]', 40),
  ('E-posta / dağıtım listesi',  'Erişim',    'Yeni e-posta kutusu, takma ad veya dağıtım listesine ekleme.',        '["manager"]',              50),
  ('Mobil hat / cihaz talebi',   'Mobil',     'Kurumsal mobil hat veya telefon talebi (maliyet içerir).',           '["manager","department"]', 60),
  ('Yeni çalışan ekipman seti',  'Onboarding','İşe yeni başlayan için standart donanım ve hesap paketi.',           '["manager"]',              70),
  ('Parola sıfırlama',           'Hesap',     'Hesap parolası sıfırlama (onay gerektirmez).',                        '[]',                       80)
) AS v(name, category, description, approval_levels, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM request_templates rt WHERE rt.name = v.name);
