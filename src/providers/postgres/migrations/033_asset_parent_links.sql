-- Many-to-many parent links for Network/Server topology (e.g. HA firewalls
-- sharing the same switch children). Legacy assets.parent_asset_id is kept as a
-- denormalized "primary" parent (first by asset_tag) for older readers.

CREATE TABLE IF NOT EXISTS asset_parent_links (
  child_asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  parent_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (child_asset_id, parent_asset_id),
  CHECK (child_asset_id <> parent_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_parent_links_parent
  ON asset_parent_links (parent_asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_parent_links_child
  ON asset_parent_links (child_asset_id);

-- Backfill from single-parent column without losing existing links.
INSERT INTO asset_parent_links (child_asset_id, parent_asset_id)
SELECT id, parent_asset_id
  FROM assets
 WHERE parent_asset_id IS NOT NULL
ON CONFLICT DO NOTHING;
