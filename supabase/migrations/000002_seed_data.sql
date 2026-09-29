-- Seed data for demonstration (independent of auth.users)
-- Only seed tables that do not depend on auth.users or other seeded tables that depend on auth.users.

-- Insert audiences (ensure they exist)
INSERT INTO audiences (id, label, note) VALUES
    ('backend', 'Backend & API', 'Node, Go, Rust, Postgres'),
    ('frontend', 'Frontend & Web', 'React, TypeScript, CSS'),
    ('devops', 'DevOps & Platform', 'CI, Kubernetes, observability'),
    ('data', 'Data & ML', 'Pipelines, notebooks, model ops'),
    ('oss', 'OSS maintainers', 'Public repos, 1k+ stars')
ON CONFLICT (id) DO NOTHING;

-- Ensure a default row exists in platform settings (active_campaign_id will be NULL until a campaign is set)
INSERT INTO platform_settings (id, active_campaign_id)
SELECT gen_random_uuid(), NULL
WHERE NOT EXISTS (SELECT 1 FROM platform_settings);
