  import app from "./app";
  import { logger } from "./lib/logger";
  import { pool, db, scanSessionsTable, pageResultsTable, usersTable } from "@workspace/db";
  import { inArray, eq, and, lt } from "drizzle-orm";
  import { startScan, startScanWatchdog } from "./lib/scanQueue";
  import { resumeOrphanedCrawlerSessions, runScheduledCrawls, runDueCrawlerSessions } from "./lib/crawler";
  import { recoverAIAssessments } from "./lib/ai-assessment";
  import bcrypt from "bcryptjs";
  import { execSync } from "child_process";
  import { existsSync, readdirSync } from "fs";
  import path from "path";
  
  async function runStartupMigrations(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
  
      // 1. Create the projects table if it does not exist yet.
      await client.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id         SERIAL PRIMARY KEY,
          name       TEXT   NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // 2. Add project_id FK column to scan_sessions if it does not exist yet.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_sessions'
              AND column_name = 'project_id'
          ) THEN
            ALTER TABLE scan_sessions
              ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
          END IF;
        END
        $$
      `);
  
      // 3. Add initiator metadata columns to scan_sessions if they do not exist yet.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_sessions'
              AND column_name = 'initiator_name'
          ) THEN
            ALTER TABLE scan_sessions
              ADD COLUMN initiator_name TEXT;
          END IF;
  
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_sessions'
              AND column_name = 'initiator_role'
          ) THEN
            ALTER TABLE scan_sessions
              ADD COLUMN initiator_role TEXT;
          END IF;
        END
        $$
      `);
  
      // 4. Create session table for connect-pg-simple
      await client.query(`
        CREATE TABLE IF NOT EXISTS "session" (
          "sid"    VARCHAR NOT NULL COLLATE "default",
          "sess"   JSON    NOT NULL,
          "expire" TIMESTAMP(6) NOT NULL,
          CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
        ) WITH (OIDS=FALSE)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
      `);
  
      // 5. Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id                      SERIAL PRIMARY KEY,
          email                   TEXT    NOT NULL UNIQUE,
          username                TEXT    NOT NULL UNIQUE,
          password_hash           TEXT    NOT NULL,
          full_name               TEXT    NOT NULL,
          profile_image_url       TEXT,
          profile_image_content_type TEXT,
          role                    TEXT    NOT NULL DEFAULT 'user',
          is_active               BOOLEAN NOT NULL DEFAULT TRUE,
          must_reset_password     BOOLEAN NOT NULL DEFAULT TRUE,
          invite_token            TEXT,
          invite_token_expires_at TIMESTAMP,
          created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'profile_image_url'
          ) THEN
            ALTER TABLE users ADD COLUMN profile_image_url TEXT;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'profile_image_content_type'
          ) THEN
            ALTER TABLE users ADD COLUMN profile_image_content_type TEXT;
          END IF;
        END
        $$
      `);
  
      // 6. Create user_groups table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_groups (
          id          SERIAL PRIMARY KEY,
          name        TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // Additive group permissions. Group grants are independent from direct
      // user permissions and from site membership/access assignments.
      await client.query(`
        ALTER TABLE user_groups
          ADD COLUMN IF NOT EXISTS can_scan BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_export BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_view_all_scans BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_edit_scan BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_delete_scan BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_manage_scan BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_create_project BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_delete_project BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_disable_js BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_smart_analysis BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_switch_site BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_create_crawl BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_delete_crawl BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_view_crawl_history BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_view_quality_assurance BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_view_site_accessibility_dashboard BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_manage_sites BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_view_issues BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_create_issue BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_edit_issue BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_comment_issue BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS can_manage_issues BOOLEAN NOT NULL DEFAULT FALSE
      `);
  
      // 7. Create user_group_members table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_group_members (
          user_id  INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
          group_id INTEGER NOT NULL REFERENCES user_groups(id)  ON DELETE CASCADE,
          PRIMARY KEY (user_id, group_id)
        )
      `);
  
      // 8. Create support_tickets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id          SERIAL PRIMARY KEY,
          user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject     TEXT    NOT NULL,
          description TEXT    NOT NULL,
          status      TEXT    NOT NULL DEFAULT 'open',
          priority    TEXT    NOT NULL DEFAULT 'medium',
          created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // 9. Create ticket_replies table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ticket_replies (
          id         SERIAL PRIMARY KEY,
          ticket_id  INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          user_id    INTEGER NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
          message    TEXT    NOT NULL,
          is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // 9b. In-app issue tracking
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_issues (
          id SERIAL PRIMARY KEY,
          issue_key TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL DEFAULT 'task',
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'todo',
          priority TEXT NOT NULL DEFAULT 'medium',
          severity TEXT,
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          site_id INTEGER,
          scan_id INTEGER REFERENCES scan_sessions(id) ON DELETE SET NULL,
          page_id INTEGER REFERENCES page_results(id) ON DELETE SET NULL,
          rule_id TEXT,
          selector TEXT,
          source_description TEXT,
          assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          labels JSONB NOT NULL DEFAULT '[]',
          checklist JSONB NOT NULL DEFAULT '[]',
          acceptance_criteria TEXT,
          environment TEXT,
          steps_to_reproduce TEXT,
          expected_result TEXT,
          actual_result TEXT,
          due_date DATE,
          sprint TEXT,
          related_issue_ids JSONB NOT NULL DEFAULT '[]',
          epic_id INTEGER REFERENCES app_issues(id) ON DELETE SET NULL,
          archived BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS app_issues_site_idx ON app_issues(site_id);
        CREATE INDEX IF NOT EXISTS app_issues_project_idx ON app_issues(project_id);
        CREATE INDEX IF NOT EXISTS app_issues_status_idx ON app_issues(status);
        CREATE INDEX IF NOT EXISTS app_issues_assignee_idx ON app_issues(assignee_id);
        CREATE TABLE IF NOT EXISTS app_issue_links (
          id SERIAL PRIMARY KEY,
          source_issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          target_issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          link_type TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT app_issue_links_unique UNIQUE (source_issue_id, target_issue_id, link_type),
          CONSTRAINT app_issue_links_not_self CHECK (source_issue_id <> target_issue_id),
          CONSTRAINT app_issue_links_canonical_type CHECK (link_type IN ('parent', 'blocks', 'relates_to', 'duplicates')),
          CONSTRAINT app_issue_links_relates_order CHECK (link_type <> 'relates_to' OR source_issue_id < target_issue_id)
        );
        CREATE INDEX IF NOT EXISTS app_issue_links_source_idx ON app_issue_links(source_issue_id);
        CREATE INDEX IF NOT EXISTS app_issue_links_target_idx ON app_issue_links(target_issue_id);
        CREATE TABLE IF NOT EXISTS app_issue_comments (
          id SERIAL PRIMARY KEY,
          issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS app_issue_comments_issue_idx ON app_issue_comments(issue_id);
        CREATE TABLE IF NOT EXISTS app_issue_activity (
          id SERIAL PRIMARY KEY,
          issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          details JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS app_issue_activity_issue_idx ON app_issue_activity(issue_id);
        CREATE TABLE IF NOT EXISTS app_issue_attachments (
          id SERIAL PRIMARY KEY,
          issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          comment_id INTEGER REFERENCES app_issue_comments(id) ON DELETE CASCADE,
          uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          object_path TEXT NOT NULL,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS app_issue_attachments_issue_idx ON app_issue_attachments(issue_id);
        CREATE INDEX IF NOT EXISTS app_issue_attachments_comment_idx ON app_issue_attachments(comment_id);
      `);
      await client.query(`ALTER TABLE app_issue_attachments ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT FALSE`);
      await client.query(`ALTER TABLE app_issue_attachments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`);
      await client.query(`CREATE INDEX IF NOT EXISTS app_issue_attachments_pending_idx ON app_issue_attachments(pending, expires_at)`);
      await client.query(`DELETE FROM app_issue_attachments WHERE pending = TRUE AND expires_at < NOW()`);
      await client.query(`
        ALTER TABLE app_issues
          ADD COLUMN IF NOT EXISTS epic_id INTEGER REFERENCES app_issues(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS app_issues_epic_idx ON app_issues(epic_id);
        CREATE TABLE IF NOT EXISTS app_issue_links (
          id SERIAL PRIMARY KEY,
          source_issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          target_issue_id INTEGER NOT NULL REFERENCES app_issues(id) ON DELETE CASCADE,
          link_type TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT app_issue_links_unique UNIQUE (source_issue_id, target_issue_id, link_type)
        );
        CREATE INDEX IF NOT EXISTS app_issue_links_source_idx ON app_issue_links(source_issue_id);
        CREATE INDEX IF NOT EXISTS app_issue_links_target_idx ON app_issue_links(target_issue_id);
        DELETE FROM app_issue_links
        WHERE source_issue_id = target_issue_id
          OR link_type NOT IN ('parent', 'child', 'blocks', 'blocked_by', 'relates_to', 'duplicates', 'duplicated_by');
  
        DELETE FROM app_issue_links older
        USING app_issue_links newer
        WHERE older.id > newer.id
          AND (CASE older.link_type
            WHEN 'child' THEN 'parent'
            WHEN 'blocked_by' THEN 'blocks'
            WHEN 'duplicated_by' THEN 'duplicates'
            ELSE older.link_type
          END) = (CASE newer.link_type
            WHEN 'child' THEN 'parent'
            WHEN 'blocked_by' THEN 'blocks'
            WHEN 'duplicated_by' THEN 'duplicates'
            ELSE newer.link_type
          END)
          AND (CASE
            WHEN older.link_type IN ('child', 'blocked_by', 'duplicated_by') THEN older.target_issue_id
            WHEN older.link_type = 'relates_to' AND older.source_issue_id > older.target_issue_id THEN older.target_issue_id
            ELSE older.source_issue_id
          END) = (CASE
            WHEN newer.link_type IN ('child', 'blocked_by', 'duplicated_by') THEN newer.target_issue_id
            WHEN newer.link_type = 'relates_to' AND newer.source_issue_id > newer.target_issue_id THEN newer.target_issue_id
            ELSE newer.source_issue_id
          END)
          AND (CASE
            WHEN older.link_type IN ('child', 'blocked_by', 'duplicated_by') THEN older.source_issue_id
            WHEN older.link_type = 'relates_to' AND older.source_issue_id > older.target_issue_id THEN older.source_issue_id
            ELSE older.target_issue_id
          END) = (CASE
            WHEN newer.link_type IN ('child', 'blocked_by', 'duplicated_by') THEN newer.source_issue_id
            WHEN newer.link_type = 'relates_to' AND newer.source_issue_id > newer.target_issue_id THEN newer.source_issue_id
            ELSE newer.target_issue_id
          END);
  
        UPDATE app_issue_links
        SET source_issue_id = CASE
              WHEN link_type IN ('child', 'blocked_by', 'duplicated_by') THEN target_issue_id
              WHEN link_type = 'relates_to' AND source_issue_id > target_issue_id THEN target_issue_id
              ELSE source_issue_id
            END,
            target_issue_id = CASE
              WHEN link_type IN ('child', 'blocked_by', 'duplicated_by') THEN source_issue_id
              WHEN link_type = 'relates_to' AND source_issue_id > target_issue_id THEN source_issue_id
              ELSE target_issue_id
            END,
            link_type = CASE link_type
              WHEN 'child' THEN 'parent'
              WHEN 'blocked_by' THEN 'blocks'
              WHEN 'duplicated_by' THEN 'duplicates'
              ELSE link_type
            END;
  
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_issue_links_not_self') THEN
            ALTER TABLE app_issue_links ADD CONSTRAINT app_issue_links_not_self CHECK (source_issue_id <> target_issue_id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_issue_links_canonical_type') THEN
            ALTER TABLE app_issue_links ADD CONSTRAINT app_issue_links_canonical_type CHECK (link_type IN ('parent', 'blocks', 'relates_to', 'duplicates'));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_issue_links_relates_order') THEN
            ALTER TABLE app_issue_links ADD CONSTRAINT app_issue_links_relates_order CHECK (link_type <> 'relates_to' OR source_issue_id < target_issue_id);
          END IF;
        END $$;
  
        INSERT INTO app_issue_links (source_issue_id, target_issue_id, link_type, created_by)
        SELECT LEAST(issue.id, legacy.target_id), GREATEST(issue.id, legacy.target_id), 'relates_to', issue.reporter_id
        FROM app_issues issue
        CROSS JOIN LATERAL (
          SELECT value::integer AS target_id
          FROM jsonb_array_elements_text(issue.related_issue_ids)
          WHERE value ~ '^[0-9]+$'
        ) legacy
        WHERE issue.id <> legacy.target_id
        ON CONFLICT (source_issue_id, target_issue_id, link_type) DO NOTHING;
      `);
      // Replace the legacy shared issue workflow with the type-specific lifecycle.
      // Completed task/story records and closed bug records remain terminal; legacy
      // cancellations are retained as archived records rather than active statuses.
      await client.query(`
        ALTER TABLE app_issues ALTER COLUMN status SET DEFAULT 'todo';
         ALTER TABLE app_issues ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
         ALTER TABLE app_issue_comments ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]';
        UPDATE app_issues SET status = 'todo' WHERE status = 'backlog';
        UPDATE app_issues SET status = 'review' WHERE status = 'in_review';
         UPDATE app_issues SET status = 'deployed'
         WHERE type IN ('task', 'story') AND status = 'fixed';
        UPDATE app_issues
        SET status = CASE WHEN type = 'bug' THEN 'closed' ELSE 'complete' END
        WHERE status = 'done';
        UPDATE app_issues
        SET status = CASE WHEN type = 'bug' THEN 'closed' ELSE 'complete' END,
            archived = TRUE
        WHERE status = 'cancelled';
      `);
  
      // 10. Add group_id to scan_sessions
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_sessions'
              AND column_name = 'group_id'
          ) THEN
            ALTER TABLE scan_sessions
              ADD COLUMN group_id INTEGER REFERENCES user_groups(id) ON DELETE SET NULL;
          END IF;
        END
        $$
      `);
  
      // 11. Create user_permissions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_permissions (
          user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          can_scan            BOOLEAN NOT NULL DEFAULT TRUE,
          can_export          BOOLEAN NOT NULL DEFAULT TRUE,
          can_view_all_scans  BOOLEAN NOT NULL DEFAULT FALSE,
          allowed_rules       JSONB,
          updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
      `);
      await client.query(`
        ALTER TABLE user_permissions
          ADD COLUMN IF NOT EXISTS can_view_issues BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS can_create_issue BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS can_edit_issue BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS can_comment_issue BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS can_manage_issues BOOLEAN NOT NULL DEFAULT TRUE
      `);
  
      // 12. Add role_label to user_groups
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'user_groups' AND column_name = 'role_label'
          ) THEN
            ALTER TABLE user_groups ADD COLUMN role_label TEXT;
          END IF;
        END
        $$
      `);
  
      // 13. Add new permission columns to user_permissions
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_edit_scan') THEN
            ALTER TABLE user_permissions ADD COLUMN can_edit_scan BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_delete_scan') THEN
            ALTER TABLE user_permissions ADD COLUMN can_delete_scan BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_manage_scan') THEN
            ALTER TABLE user_permissions ADD COLUMN can_manage_scan BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_create_project') THEN
            ALTER TABLE user_permissions ADD COLUMN can_create_project BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_delete_project') THEN
            ALTER TABLE user_permissions ADD COLUMN can_delete_project BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
        END
        $$
      `);
  
      // 13b. Add crawler and site dashboard permissions.
      // These are explicit so existing production user_permissions rows receive
      // the same defaults as newly created rows.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_create_crawl') THEN
            ALTER TABLE user_permissions ADD COLUMN can_create_crawl BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_delete_crawl') THEN
            ALTER TABLE user_permissions ADD COLUMN can_delete_crawl BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_view_crawl_history') THEN
            ALTER TABLE user_permissions ADD COLUMN can_view_crawl_history BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_view_quality_assurance') THEN
            ALTER TABLE user_permissions ADD COLUMN can_view_quality_assurance BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_view_site_accessibility_dashboard') THEN
            ALTER TABLE user_permissions ADD COLUMN can_view_site_accessibility_dashboard BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_manage_sites') THEN
            ALTER TABLE user_permissions ADD COLUMN can_manage_sites BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
        END
        $$
      `);
  
      // 13c. Per-site accessibility target score and permission.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sites' AND column_name = 'target_score') THEN
            ALTER TABLE sites ADD COLUMN target_score INTEGER;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_manage_site_target_score') THEN
            ALTER TABLE user_permissions ADD COLUMN can_manage_site_target_score BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_groups' AND column_name = 'can_manage_site_target_score') THEN
            ALTER TABLE user_groups ADD COLUMN can_manage_site_target_score BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
        END
        $$
      `);
  
      // 13d. HTML replay is opt-in because captured page source can contain
      // sensitive content. Super Admin receives it through FULL_ACCESS; all
      // other roles, including Admin, require an explicit user/group grant.
      await client.query(`
        ALTER TABLE user_permissions
          ADD COLUMN IF NOT EXISTS can_view_html_replay BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE user_groups
          ADD COLUMN IF NOT EXISTS can_view_html_replay BOOLEAN NOT NULL DEFAULT FALSE;
      `);
  
      // 14. Assign orphaned scans (NULL user_id) to superadmin
      await client.query(`
        UPDATE scan_sessions
        SET user_id = (SELECT id::text FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1)
        WHERE user_id IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE role = 'super_admin')
      `);
  
      // 15. Create app_settings table (key-value store for SMTP, logo, etc.)
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key        TEXT    PRIMARY KEY,
          value      TEXT,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
      `);
  
      // 16. Create scan_domain_profiles table for adaptive scan domain memory
      await client.query(`
        CREATE TABLE IF NOT EXISTS scan_domain_profiles (
          id                  SERIAL      PRIMARY KEY,
          domain              TEXT        NOT NULL UNIQUE,
          strategy            TEXT        NOT NULL DEFAULT 'context_pool',
          has_cloudflare      BOOLEAN     NOT NULL DEFAULT FALSE,
          requires_js         BOOLEAN     NOT NULL DEFAULT FALSE,
          has_rate_limit      BOOLEAN     NOT NULL DEFAULT FALSE,
          success_rate        REAL        NOT NULL DEFAULT 1.0,
          total_scans         INTEGER     NOT NULL DEFAULT 0,
          fingerprint_signals JSONB,
          last_scan_at        TIMESTAMP,
          created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
          updated_at          TIMESTAMP   NOT NULL DEFAULT NOW()
        )
      `);
  
      // 17. Add page_results columns added after initial deploy
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'page_results' AND column_name = 'load_duration_ms') THEN
            ALTER TABLE page_results ADD COLUMN load_duration_ms INTEGER;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'page_results' AND column_name = 'scan_duration_ms') THEN
            ALTER TABLE page_results ADD COLUMN scan_duration_ms INTEGER;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'page_results' AND column_name = 'screenshot') THEN
            ALTER TABLE page_results ADD COLUMN screenshot TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'page_results' AND column_name = 'page_html') THEN
            ALTER TABLE page_results ADD COLUMN page_html TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'page_results' AND column_name = 'content_hash') THEN
            ALTER TABLE page_results ADD COLUMN content_hash TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'page_results' AND column_name = 'carried_forward') THEN
            ALTER TABLE page_results ADD COLUMN carried_forward BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
          CREATE INDEX IF NOT EXISTS page_results_url_hash_idx ON page_results (url, content_hash);
        END
        $$
      `);
  
      // 18. Add scan_sessions.options if missing (JSONB column for scan config)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scan_sessions' AND column_name = 'options') THEN
            ALTER TABLE scan_sessions ADD COLUMN options JSONB;
          END IF;
        END
        $$
      `);
  
      // 19. Add accessibility_issues columns added after initial deploy.
      // If any of these are missing the INSERT in scanQueue.ts throws and the page
      // ends up with issue_count > 0 but zero rows in accessibility_issues.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'legal_text') THEN
            ALTER TABLE accessibility_issues ADD COLUMN legal_text TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'selector') THEN
            ALTER TABLE accessibility_issues ADD COLUMN selector TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'remediation') THEN
            ALTER TABLE accessibility_issues ADD COLUMN remediation TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'bbox_x') THEN
            ALTER TABLE accessibility_issues ADD COLUMN bbox_x REAL;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'bbox_y') THEN
            ALTER TABLE accessibility_issues ADD COLUMN bbox_y REAL;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'bbox_width') THEN
            ALTER TABLE accessibility_issues ADD COLUMN bbox_width REAL;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'bbox_height') THEN
            ALTER TABLE accessibility_issues ADD COLUMN bbox_height REAL;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'false_positive') THEN
            ALTER TABLE accessibility_issues ADD COLUMN false_positive BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'false_positive_note') THEN
            ALTER TABLE accessibility_issues ADD COLUMN false_positive_note TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accessibility_issues' AND column_name = 'element_context') THEN
            ALTER TABLE accessibility_issues ADD COLUMN element_context TEXT;
          END IF;
        END
        $$
      `);
  
      // 20. Add can_disable_js to user_permissions (JS-disabled scan permission)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_disable_js') THEN
            ALTER TABLE user_permissions ADD COLUMN can_disable_js BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
        END
        $$
      `);
  
      // 20b. Add can_smart_analysis to user_permissions (Smart Analysis feature access)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_permissions' AND column_name = 'can_smart_analysis') THEN
            ALTER TABLE user_permissions ADD COLUMN can_smart_analysis BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
        END
        $$
      `);
  
      // 20c. Rule-ID rebrand: legacy SIA-* rule ids become ACT-* everywhere.
      // Historical rows are renamed once so old and new scans display the same
      // rule identifiers. (The legacy id is derivable: ACT-Rn ↔ SIA-Rn.)
      // Runs BEFORE the wcag_criteria backfills so those match on ACT ids.
      await client.query(`
        UPDATE accessibility_issues SET rule_id = 'ACT-' || substring(rule_id from 5)
        WHERE rule_id LIKE 'SIA-%'
      `);
  
      // 20d. Backfill WCAG mappings on historical issues: ACT-R84 rows scanned
      // before the mapping existed, and ACT-R35 rows stored with the old 1.2.1
      // mapping (corrected to 1.3.1)
      await client.query(`
        UPDATE accessibility_issues SET wcag_criteria = '2.1.1'
        WHERE rule_id = 'ACT-R84' AND (wcag_criteria IS NULL OR wcag_criteria = '')
      `);
      await client.query(`
        UPDATE accessibility_issues SET wcag_criteria = '1.3.1'
        WHERE rule_id = 'ACT-R35' AND wcag_criteria = '1.2.1'
      `);
      await client.query(`
        UPDATE accessibility_issues SET wcag_criteria = '1.2.3'
        WHERE rule_id = 'ACT-R31' AND (wcag_criteria = '1.4.8' OR wcag_criteria = '1.2.1')
      `);
  
      // 20d2. Correct the legacy ACT-R32 target-size implementation.
      // SIA-R32 is the visual-only-video audio-track rule, not a target-size
      // rule. Earlier deployments stored 44×44 enhanced and 24×24 minimum
      // target findings under R32; classify only those recognisable historical
      // descriptions so genuine R32 video findings remain untouched.
      await client.query(`
        UPDATE accessibility_issues
        SET
          rule_id = CASE
            WHEN description ILIKE '%44×44%' OR description ILIKE '%enhanced touch target%'
              THEN 'ACT-R111'
            ELSE 'ACT-R113'
          END,
          description = CASE
            WHEN description ILIKE '%44×44%' OR description ILIKE '%enhanced touch target%'
              THEN regexp_replace(
                description,
                '^Target size is too small:',
                'Interactive element does not meet enhanced size:'
              )
            ELSE replace(
              regexp_replace(
                description,
                '^(Target size is too small|Interactive element does not meet enhanced target size \\(2\\.5\\.5\\)):',
                'Touch target size is too small:'
              ),
              'enhanced target size',
              'minimum touch target size'
            )
          END,
          wcag_criteria = CASE
            WHEN description ILIKE '%44×44%' OR description ILIKE '%enhanced touch target%'
              THEN '2.5.5'
            ELSE '2.5.8'
          END,
          wcag_level = CASE
            WHEN description ILIKE '%44×44%' OR description ILIKE '%enhanced touch target%'
              THEN 'AAA'
            ELSE 'AA'
          END,
          impact = CASE
            WHEN description ILIKE '%44×44%' OR description ILIKE '%enhanced touch target%'
              THEN 'minor'
            ELSE 'moderate'
          END
        WHERE rule_id = 'ACT-R32'
          AND (
            description ILIKE '%target size%'
            OR description ILIKE '%touch target%'
          )
      `);
  
      // 20e. Add rule_type column to accessibility_issues (stores Issue / Potential Issue / Best Practice)
      await client.query(`
        ALTER TABLE accessibility_issues ADD COLUMN IF NOT EXISTS rule_type TEXT NOT NULL DEFAULT 'Issue'
      `);
  
      // 21. Seed default scan_page_timeout_ms if not already set
      await client.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('scan_page_timeout_ms', '10000', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
  
      // 22. Migrate the previous scan-delay default (2 000 ms) to 10 000 ms.
      //     Only update the known default; user-customised values are preserved.
      await client.query(`
        UPDATE app_settings
        SET value = '10000', updated_at = NOW()
        WHERE key = 'scan_page_timeout_ms' AND value = '2000'
      `);
  
      // 23. Create crawler_sessions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS crawler_sessions (
          id                  SERIAL      PRIMARY KEY,
          user_id             TEXT,
          name                TEXT        NOT NULL,
          seed_url            TEXT        NOT NULL,
          status              TEXT        NOT NULL DEFAULT 'pending',
          config              JSONB       NOT NULL DEFAULT '{}',
          scan_session_id     INTEGER     REFERENCES scan_sessions(id) ON DELETE SET NULL,
          total_discovered    INTEGER     NOT NULL DEFAULT 0,
          total_scanned       INTEGER     NOT NULL DEFAULT 0,
          total_failed        INTEGER     NOT NULL DEFAULT 0,
          total_skipped       INTEGER     NOT NULL DEFAULT 0,
          total_issues        INTEGER     NOT NULL DEFAULT 0,
          total_rules         INTEGER     NOT NULL DEFAULT 0,
          broken_links_count  INTEGER     NOT NULL DEFAULT 0,
          created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
          started_at          TIMESTAMP,
          completed_at        TIMESTAMP,
          paused_at           TIMESTAMP,
          error_message       TEXT
        )
      `);
  
      // 23b. Add total_rules to existing crawler_sessions tables.
      // The column is included above for new databases, while this migration
      // brings existing Azure/PostgreSQL deployments up to the current schema.
      await client.query(`
        ALTER TABLE crawler_sessions
          ADD COLUMN IF NOT EXISTS total_rules INTEGER NOT NULL DEFAULT 0
      `);
  
      // 24. Create crawler_pages table
      await client.query(`
        CREATE TABLE IF NOT EXISTS crawler_pages (
          id               SERIAL    PRIMARY KEY,
          session_id       INTEGER   NOT NULL REFERENCES crawler_sessions(id) ON DELETE CASCADE,
          url              TEXT      NOT NULL,
          url_hash         TEXT      NOT NULL,
          status           TEXT      NOT NULL DEFAULT 'pending',
          depth            INTEGER   NOT NULL DEFAULT 0,
          discovered_from  TEXT,
          content_hash     TEXT,
          http_status      INTEGER,
          issue_count      INTEGER   NOT NULL DEFAULT 0,
          error_message    TEXT,
          scanned_at       TIMESTAMP,
          UNIQUE(session_id, url_hash)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS crawler_pages_session_status_idx ON crawler_pages(session_id, status)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS crawler_pages_session_hash_idx ON crawler_pages(session_id, url_hash)
      `);
  
      // 25. Create broken_links table
      await client.query(`
        CREATE TABLE IF NOT EXISTS broken_links (
          id          SERIAL    PRIMARY KEY,
          session_id  INTEGER   NOT NULL REFERENCES crawler_sessions(id) ON DELETE CASCADE,
          source_url  TEXT      NOT NULL,
          broken_url  TEXT      NOT NULL,
          http_status INTEGER,
          error_type  TEXT,
          anchor_text TEXT,
          checked_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS broken_links_session_idx ON broken_links(session_id)
      `);
  
      // 26. Create sites table
      await client.query(`
        CREATE TABLE IF NOT EXISTS sites (
          id          SERIAL    PRIMARY KEY,
          user_id     TEXT,
          name        TEXT      NOT NULL,
          base_url    TEXT      NOT NULL,
          description TEXT,
          created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // 27. Add site_id column to crawler_sessions
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'crawler_sessions' AND column_name = 'site_id'
          ) THEN
            ALTER TABLE crawler_sessions
              ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;
          END IF;
        END
        $$
      `);
  
      // 28. Add page_type to crawler_pages + discovered_at to crawler_sessions
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'crawler_pages' AND column_name = 'page_type'
          ) THEN
            ALTER TABLE crawler_pages ADD COLUMN page_type TEXT;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'crawler_sessions' AND column_name = 'discovered_at'
          ) THEN
            ALTER TABLE crawler_sessions ADD COLUMN discovered_at TIMESTAMP;
          END IF;
        END
        $$
      `);
  
      // 28c. Bring existing crawler_pages tables up to the current page schema.
      // CREATE TABLE IF NOT EXISTS does not alter an older Azure table, so every
      // column introduced after the initial crawler release must be idempotently
      // added for existing deployments as well.
      await client.query(`
        ALTER TABLE crawler_pages
          ADD COLUMN IF NOT EXISTS rule_count INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS captured_html TEXT
      `);
  
      // 28b. Siteimprove-style crawl policy, scheduling, and URL disposition tables.
      // All additions are idempotent so existing sites and crawler sessions remain
      // usable with their saved configuration.
      await client.query(`
        ALTER TABLE sites
          ADD COLUMN IF NOT EXISTS default_scope TEXT NOT NULL DEFAULT 'subdomain',
          ADD COLUMN IF NOT EXISTS sitemap_url TEXT,
          ADD COLUMN IF NOT EXISTS crawl_type TEXT NOT NULL DEFAULT 'javascript',
          ADD COLUMN IF NOT EXISTS max_pages INTEGER NOT NULL DEFAULT 2000,
          ADD COLUMN IF NOT EXISTS max_depth INTEGER NOT NULL DEFAULT 5,
          ADD COLUMN IF NOT EXISTS respect_robots_txt BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS asset_mode TEXT NOT NULL DEFAULT 'all',
          ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS schedule_interval_days INTEGER NOT NULL DEFAULT 7,
          ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
          ADD COLUMN IF NOT EXISTS next_crawl_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS last_completed_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'idle'
      `);
      await client.query(`
        ALTER TABLE crawler_sessions
          ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'queued',
          ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMP
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_content_rules (
          id            SERIAL PRIMARY KEY,
          site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          rule_type     TEXT NOT NULL,
          pattern       TEXT NOT NULL,
          pattern_type  TEXT NOT NULL DEFAULT 'contains',
          note          TEXT,
          enabled       BOOLEAN NOT NULL DEFAULT TRUE,
          created_by    TEXT,
          created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS site_content_rules_site_idx
        ON site_content_rules(site_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS crawler_url_events (
          id           SERIAL PRIMARY KEY,
          session_id   INTEGER NOT NULL REFERENCES crawler_sessions(id) ON DELETE CASCADE,
          url          TEXT NOT NULL,
          disposition  TEXT NOT NULL,
          reason       TEXT NOT NULL,
          source_url   TEXT,
          rule_id      INTEGER REFERENCES site_content_rules(id) ON DELETE SET NULL,
          created_at   TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS crawler_url_events_session_idx
        ON crawler_url_events(session_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS crawler_url_events_disposition_idx
        ON crawler_url_events(session_id, disposition)
      `);
  
      // 30. Add rule_count to crawler_pages (distinct rules with ≥1 occurrence per page)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'crawler_pages' AND column_name = 'rule_count'
          ) THEN
            ALTER TABLE crawler_pages ADD COLUMN rule_count INTEGER NOT NULL DEFAULT 0;
          END IF;
        END
        $$
      `);
  
      // 29. Create crawler_discovery_cache table
      await client.query(`
        CREATE TABLE IF NOT EXISTS crawler_discovery_cache (
          id                SERIAL PRIMARY KEY,
          domain            TEXT    NOT NULL UNIQUE,
          seed_url          TEXT    NOT NULL,
          source_session_id INTEGER REFERENCES crawler_sessions(id) ON DELETE SET NULL,
          url_count         INTEGER NOT NULL DEFAULT 0,
          cached_at         TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // 31. Create site_score_history table (persists per-session score for history + delta)
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_score_history (
          id                  SERIAL       PRIMARY KEY,
          site_id             INTEGER      NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          crawler_session_id  INTEGER      NOT NULL REFERENCES crawler_sessions(id) ON DELETE CASCADE,
          score               NUMERIC(5,1) NOT NULL,
          scanned_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
          UNIQUE(crawler_session_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS site_score_history_site_idx
        ON site_score_history(site_id, scanned_at DESC)
      `);
  
      // 32. QA pages table — per-page metadata collected during accessibility scans
      await client.query(`
        CREATE TABLE IF NOT EXISTS qa_pages (
          id            SERIAL      PRIMARY KEY,
          scan_id       INTEGER     NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
          url           TEXT        NOT NULL,
          title         TEXT,
          meta_description TEXT,
          h1            TEXT,
          http_status   INTEGER,
          word_count    INTEGER,
          content_hash  TEXT,
          crawl_depth   INTEGER,
          inlink_count  INTEGER     NOT NULL DEFAULT 0,
          is_pdf        BOOLEAN     NOT NULL DEFAULT FALSE,
          last_modified TEXT,
          scanned_at    TIMESTAMP   DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS qa_pages_scan_id_idx ON qa_pages(scan_id)
      `);
  
      // 33. QA links table — link graph collected during accessibility scans
      await client.query(`
        CREATE TABLE IF NOT EXISTS qa_links (
          id           SERIAL    PRIMARY KEY,
          scan_id      INTEGER   NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
          source_url   TEXT      NOT NULL,
          dest_url     TEXT      NOT NULL,
          anchor_text  TEXT,
          link_type    TEXT      NOT NULL DEFAULT 'internal',
          http_status  INTEGER,
          is_redirect  BOOLEAN   NOT NULL DEFAULT FALSE,
          redirect_to  TEXT,
          checked_at   TIMESTAMP
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS qa_links_scan_id_idx ON qa_links(scan_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS qa_links_dest_url_idx ON qa_links(scan_id, dest_url)
      `);
  
      // 34. Crawler QA pipeline — new columns on existing tables
      await client.query(`ALTER TABLE qa_pages ADD COLUMN IF NOT EXISTS body_text TEXT`);
      await client.query(`ALTER TABLE qa_pages ADD COLUMN IF NOT EXISTS in_sitemap BOOLEAN NOT NULL DEFAULT FALSE`);
      await client.query(`ALTER TABLE qa_links ADD COLUMN IF NOT EXISTS is_unsafe BOOLEAN NOT NULL DEFAULT FALSE`);
  
      // 35. QA images table
      await client.query(`
        CREATE TABLE IF NOT EXISTS qa_images (
          id           SERIAL    PRIMARY KEY,
          scan_id      INTEGER   NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
          source_url   TEXT      NOT NULL,
          src          TEXT      NOT NULL,
          alt          TEXT,
          width        INTEGER,
          height       INTEGER,
          is_external  BOOLEAN   NOT NULL DEFAULT FALSE,
          http_status  INTEGER,
          is_broken    BOOLEAN   NOT NULL DEFAULT FALSE,
          checked_at   TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS qa_images_scan_id_idx ON qa_images(scan_id)`);
  
      // 36. QA word inventory table
      await client.query(`
        CREATE TABLE IF NOT EXISTS qa_word_inventory (
          id           SERIAL    PRIMARY KEY,
          scan_id      INTEGER   NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
          word         TEXT      NOT NULL,
          page_count   INTEGER   NOT NULL DEFAULT 0,
          total_count  INTEGER   NOT NULL DEFAULT 0
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS qa_word_inventory_scan_id_idx ON qa_word_inventory(scan_id)`);
  
      // 37. Per-occurrence contextual AI assessments. The request context stores
      // bounded evidence only, so interrupted workers can safely resume after a
      // process restart without retaining raw provider output or credentials.
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_issue_assessments (
          id              SERIAL PRIMARY KEY,
          issue_id        INTEGER NOT NULL UNIQUE REFERENCES accessibility_issues(id) ON DELETE CASCADE,
          status          TEXT NOT NULL DEFAULT 'queued',
          decision        TEXT,
          confidence      TEXT,
          rationale       TEXT,
          evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,
          engine          TEXT NOT NULL DEFAULT 'Alfa/custom browser',
          provider        TEXT,
          model           TEXT,
          attempts        INTEGER NOT NULL DEFAULT 0,
          request_context JSONB NOT NULL,
          error_message   TEXT,
          queued_at       TIMESTAMP NOT NULL DEFAULT NOW(),
          started_at      TIMESTAMP,
          completed_at    TIMESTAMP,
          updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS ai_issue_assessments_status_idx ON ai_issue_assessments(status)`);
  
      // issue_decisions — false positive / can't-fix decisions per occurrence
      await client.query(`
        CREATE TABLE IF NOT EXISTS issue_decisions (
          id               SERIAL    PRIMARY KEY,
          scan_session_id  INTEGER   NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
          page_id          INTEGER,
          issue_id         INTEGER,
          rule_id          TEXT      NOT NULL,
          selector         TEXT,
          element_snippet  TEXT,
          page_url         TEXT,
          issue_description TEXT,
          decision_type    TEXT      NOT NULL,
          scope            TEXT      NOT NULL DEFAULT 'single',
          reason           TEXT,
          submitted_by     INTEGER   NOT NULL,
          submitter_name   TEXT,
          review_status    TEXT      NOT NULL DEFAULT 'pending',
          reviewed_by      INTEGER,
          reviewer_name    TEXT,
          review_comment   TEXT,
          created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS issue_decisions_scan_id_idx ON issue_decisions(scan_session_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS issue_decisions_submitted_by_idx ON issue_decisions(submitted_by)`);
  
      // Add class_pattern and pages_affected columns to issue_decisions if missing
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'issue_decisions' AND column_name = 'class_pattern'
          ) THEN
            ALTER TABLE issue_decisions ADD COLUMN class_pattern TEXT;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'issue_decisions' AND column_name = 'pages_affected'
          ) THEN
            ALTER TABLE issue_decisions ADD COLUMN pages_affected INTEGER;
          END IF;
        END
        $$
      `);
  
      // Add scan_started_at to crawler_sessions (tracks when Phase 2 began)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'crawler_sessions' AND column_name = 'scan_started_at'
          ) THEN
            ALTER TABLE crawler_sessions ADD COLUMN scan_started_at TIMESTAMP;
          END IF;
        END
        $$
      `);
  
      // Add can_switch_site to user_permissions (site dropdown access for non-super_admin)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'user_permissions' AND column_name = 'can_switch_site'
          ) THEN
            ALTER TABLE user_permissions ADD COLUMN can_switch_site BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
        END
        $$
      `);
  
      // 37. site_user_access — direct per-user site access (multi-site model)
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_user_access (
          id         SERIAL    PRIMARY KEY,
          site_id    INTEGER   NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role       TEXT      NOT NULL DEFAULT 'member',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(site_id, user_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS site_user_access_site_idx ON site_user_access(site_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS site_user_access_user_idx ON site_user_access(user_id)`);
  
      // 38. site_group_access — group-level site access (users inherit via group membership)
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_group_access (
          id         SERIAL    PRIMARY KEY,
          site_id    INTEGER   NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          group_id   INTEGER   NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(site_id, group_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS site_group_access_site_idx ON site_group_access(site_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS site_group_access_group_idx ON site_group_access(group_id)`);
  
      // 39. Enforce role domain on site_user_access (idempotent via DO block)
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'site_user_access_role_check'
              AND conrelid = 'site_user_access'::regclass
          ) THEN
            ALTER TABLE site_user_access
              ADD CONSTRAINT site_user_access_role_check
              CHECK (role IN ('owner', 'member'));
          END IF;
        END $$
      `);
  
      // 40. Add site_id to scan_sessions — associates a manual scan with a site
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'scan_sessions' AND column_name = 'site_id'
          ) THEN
            ALTER TABLE scan_sessions
              ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS scan_sessions_site_id_idx ON scan_sessions(site_id);
          END IF;
        END $$
      `);
  
      // 41. Backfill site_id on existing scan_sessions by matching their page URLs to
      //     sites.base_url. scan_sessions has no direct url column — URLs live in
      //     page_results. Picks the longest matching (most specific) site.
      //     Safe to re-run — only touches rows where site_id IS NULL.
      await client.query(`
        UPDATE scan_sessions ss
        SET site_id = (
          SELECT s.id
          FROM sites s
          WHERE EXISTS (
            SELECT 1 FROM page_results pr
            WHERE pr.scan_id = ss.id
              AND pr.url LIKE rtrim(s.base_url, '/') || '%'
            LIMIT 1
          )
          ORDER BY LENGTH(s.base_url) DESC
          LIMIT 1
        )
        WHERE ss.site_id IS NULL
          AND EXISTS (
            SELECT 1 FROM page_results pr
            JOIN sites s ON pr.url LIKE rtrim(s.base_url, '/') || '%'
            WHERE pr.scan_id = ss.id
          )
      `);
  
      // 42. Associate projects with sites. A join table is used because legacy
      // projects may have scans belonging to more than one site.
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_sites (
          id         SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, site_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS project_sites_project_idx ON project_sites(project_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS project_sites_site_idx ON project_sites(site_id)`);
      // Link every legacy project/site pair represented by an existing scan.
      await client.query(`
        INSERT INTO project_sites (project_id, site_id)
        SELECT DISTINCT ss.project_id, ss.site_id
        FROM scan_sessions ss
        WHERE ss.project_id IS NOT NULL
          AND ss.site_id IS NOT NULL
        ON CONFLICT (project_id, site_id) DO NOTHING
      `);
  
      // 43. rule_page_stats — per-rule element/page check counts for true CRr scoring
      await client.query(`
        CREATE TABLE IF NOT EXISTS rule_page_stats (
          id              SERIAL  PRIMARY KEY,
          page_result_id  INTEGER NOT NULL REFERENCES page_results(id) ON DELETE CASCADE,
          rule_id         TEXT    NOT NULL,
          total_checked   INTEGER NOT NULL DEFAULT 0,
          scope           TEXT    NOT NULL DEFAULT 'element',
          UNIQUE(page_result_id, rule_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS rule_page_stats_page_idx ON rule_page_stats(page_result_id)
      `);
  
      // 43a. Preserve score-density data for the corrected historical R32
      // findings. This follows the CREATE TABLE step so an older Azure database
      // can safely receive the same release in a single startup.
      await client.query(`
        WITH legacy_stats AS (
          SELECT page_result_id, total_checked, scope
          FROM rule_page_stats
          WHERE rule_id = 'ACT-R32'
        ),
        corrected_rules AS (
          SELECT DISTINCT
            legacy_stats.page_result_id,
            corrected.rule_id,
            legacy_stats.total_checked,
            legacy_stats.scope
          FROM legacy_stats
          JOIN accessibility_issues AS corrected
            ON corrected.page_id = legacy_stats.page_result_id
          WHERE corrected.rule_id IN ('ACT-R111', 'ACT-R113')
        )
        INSERT INTO rule_page_stats (page_result_id, rule_id, total_checked, scope)
        SELECT page_result_id, rule_id, total_checked, scope
        FROM corrected_rules
        ON CONFLICT (page_result_id, rule_id) DO UPDATE
          SET total_checked = GREATEST(
            rule_page_stats.total_checked,
            EXCLUDED.total_checked
          ),
          scope = EXCLUDED.scope
      `);
      await client.query(`
        DELETE FROM rule_page_stats WHERE rule_id = 'ACT-R32'
      `);
  
      // 44. Per-site Page Group accessibility scan choices. Page groups are
      // derived from crawler_pages.page_type, while these preferences decide
      // which groups enter Phase 2 on future crawler scans.
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_page_group_preferences (
          site_id          INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          page_type        TEXT    NOT NULL,
          include_in_scan  BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (site_id, page_type)
        )
      `);
  
      // 45. WCAG conformance scope for each site's accessibility target. Existing
      // installations retain AA as their current default target scope.
      await client.query(`
        ALTER TABLE sites
          ADD COLUMN IF NOT EXISTS target_wcag_level TEXT NOT NULL DEFAULT 'AA'
            CHECK (target_wcag_level IN ('A', 'AA', 'AAA'))
      `);
  
      // 46. System notifications for admins
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id         SERIAL PRIMARY KEY,
          type       TEXT NOT NULL,
          title      TEXT NOT NULL,
          body       TEXT,
          link       TEXT,
          actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
          actor_name TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
  
      // 47. Per-user read tracking for notifications
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_reads (
          notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
          user_id         INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
          PRIMARY KEY (notification_id, user_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_recipients (
          notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
          user_id         INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
          PRIMARY KEY (notification_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS notification_recipients_user_idx
          ON notification_recipients(user_id, notification_id);
      `);
  
      // 48. Expand target_wcag_level CHECK constraint to allow 'All' level
      await client.query(`
        DO $$
        DECLARE v text;
        BEGIN
          SELECT constraint_name INTO v
            FROM information_schema.table_constraints
           WHERE table_name = 'sites' AND constraint_type = 'CHECK'
             AND constraint_name LIKE '%wcag%'
           LIMIT 1;
          IF v IS NOT NULL THEN
            EXECUTE 'ALTER TABLE sites DROP CONSTRAINT ' || quote_ident(v);
          END IF;
          ALTER TABLE sites
            ADD CONSTRAINT sites_target_wcag_level_check
            CHECK (target_wcag_level IN ('A','AA','AAA','All'));
        END
        $$
      `);
  
      // 49. Documentation screenshot storage
      await client.query(`
        CREATE TABLE IF NOT EXISTS doc_screenshots (
          key          TEXT PRIMARY KEY,
          image_data   BYTEA        NOT NULL,
          content_type TEXT         NOT NULL DEFAULT 'image/jpeg',
          captured_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          captured_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          width        INTEGER,
          height       INTEGER
        )
      `);
  
      // 50. State-specific evidence for safely revealed dialogs and disclosures
      await client.query(`
        CREATE TABLE IF NOT EXISTS page_interaction_states (
          id SERIAL PRIMARY KEY,
          page_id INTEGER NOT NULL REFERENCES page_results(id) ON DELETE CASCADE,
          state_key TEXT NOT NULL,
          trigger_selector TEXT,
          trigger_label TEXT,
          screenshot TEXT,
          page_html TEXT
        );
        ALTER TABLE page_interaction_states
          ADD COLUMN IF NOT EXISTS state_key TEXT,
          ADD COLUMN IF NOT EXISTS trigger_selector TEXT,
          ADD COLUMN IF NOT EXISTS trigger_label TEXT,
          ADD COLUMN IF NOT EXISTS screenshot TEXT,
          ADD COLUMN IF NOT EXISTS page_html TEXT;
        CREATE INDEX IF NOT EXISTS page_interaction_states_page_id_idx
          ON page_interaction_states(page_id);
        ALTER TABLE accessibility_issues
          ADD COLUMN IF NOT EXISTS interaction_state_id INTEGER
          REFERENCES page_interaction_states(id) ON DELETE SET NULL;
      `);
  
      await client.query("COMMIT");
      logger.info("Startup migrations completed");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err }, "Startup migration failed — server will still start");
    } finally {
      client.release();
    }
  }
  
  async function seedDefaultAdmin(): Promise<void> {
    try {
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
      if (existing) return; // Users already exist, skip seed
  
      const defaultPassword = "Admin@1234!";
      const passwordHash = await bcrypt.hash(defaultPassword, 12);
  
      await db.insert(usersTable).values({
        email: "admin@localhost",
        username: "admin",
        passwordHash,
        fullName: "Super Administrator",
        role: "super_admin",
        isActive: true,
        mustResetPassword: false,
      });
  
      logger.info("═══════════════════════════════════════════════");
      logger.info("  Default super admin created:");
      logger.info("  Username: admin");
      logger.info("  Password: Admin@1234!");
      logger.info("  Please change this password after first login!");
      logger.info("═══════════════════════════════════════════════");
    } catch (err) {
      logger.error({ err }, "Failed to seed default admin — continuing startup");
    }
  }
  
  async function recoverOrphanedScans(): Promise<void> {
    try {
      // Skip scans created in the last 3 minutes — the retry endpoint can take
      // ~30 s to bulk-insert pages for large scans.  If a new container starts
      // during that window, "pending" scans will have 0 page rows, causing
      // orphan recovery to incorrectly mark them "completed".
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
  
      const orphaned = await db
        .select({
          id: scanSessionsTable.id,
          options: scanSessionsTable.options,
        })
        .from(scanSessionsTable)
        .where(
          and(
            inArray(scanSessionsTable.status, ["pending", "running"]),
            lt(scanSessionsTable.createdAt, threeMinutesAgo),
          ),
        );
  
      if (orphaned.length === 0) {
        logger.info("No orphaned scans to recover");
        return;
      }
  
      logger.info({ count: orphaned.length }, "Recovering orphaned scans on startup");
  
      for (const session of orphaned) {
        try {
          await db
            .update(pageResultsTable)
            .set({ status: "pending" })
            .where(
              and(
                eq(pageResultsTable.scanId, session.id),
                inArray(pageResultsTable.status, [
                  "navigating",
                  "scanning",
                  "rendering",
                  "analyzing",
                  "saving",
                ])
              )
            );
  
          const remaining = await db
            .select({ url: pageResultsTable.url })
            .from(pageResultsTable)
            .where(
              and(
                eq(pageResultsTable.scanId, session.id),
                inArray(pageResultsTable.status, ["pending", "requeued"])
              )
            );
  
          if (remaining.length === 0) {
            await db
              .update(scanSessionsTable)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(scanSessionsTable.id, session.id));
            logger.info({ scanId: session.id }, "Orphaned scan had no remaining pages — marked completed");
            continue;
          }
  
          await db
            .update(scanSessionsTable)
            .set({ status: "running" })
            .where(eq(scanSessionsTable.id, session.id));
  
          const urls = remaining.map((p) => p.url);
          startScan(session.id, urls, {
            ...((session.options as Record<string, unknown>) ?? {}),
            skipCompletedPages: true,
          }).catch((err) => {
            logger.error({ scanId: session.id, err }, "Orphaned scan restart failed");
          });
  
          logger.info({ scanId: session.id, urlCount: urls.length }, "Restarted orphaned scan");
        } catch (err) {
          logger.error({ scanId: session.id, err }, "Failed to recover orphaned scan — skipping");
        }
      }
    } catch (err) {
      logger.error({ err }, "recoverOrphanedScans failed — scans may stay stuck");
    }
  }
  
  /**
   * On Linux (Azure App Service, Docker, etc.) the Puppeteer-bundled Chrome
   * binary requires several system shared libraries that may not be present in
   * a fresh container.  This function detects missing libraries via `ldd` and
   * installs them automatically so that Chrome works without any manual setup.
   *
   * It is a no-op on non-Linux platforms and safe to call on every startup
   * (apt-get is idempotent — already-installed packages are skipped instantly).
   */
  async function ensureChromeDependencies(): Promise<void> {
    if (process.platform !== "linux") return;
  
    try {
      // Locate the Puppeteer-bundled Chrome binary in the project cache.
      const cacheDir = path.join(process.cwd(), ".cache", "puppeteer", "chrome");
      if (!existsSync(cacheDir)) {
        logger.info("Puppeteer Chrome cache not found — skipping dependency check");
        return;
      }
  
      // Sort descending so the highest version number is first (e.g. linux-148 > linux-147).
      const linuxDirs = readdirSync(cacheDir)
        .filter((d) => d.startsWith("linux-"))
        .sort()
        .reverse();
      if (linuxDirs.length === 0) {
        logger.info("No linux-* Chrome version dirs found — skipping dependency check");
        return;
      }
  
      const chromePath = path.join(cacheDir, linuxDirs[0], "chrome-linux64", "chrome");
      if (!existsSync(chromePath)) {
        logger.info({ chromePath }, "Chrome binary not found at expected path — skipping");
        return;
      }
  
      // ldd exits 1 when any library is missing — we must capture stdout from the thrown error.
      let lddOut = "";
      try {
        lddOut = execSync(`ldd "${chromePath}"`, { encoding: "utf-8", timeout: 10_000 });
      } catch (lddErr: unknown) {
        const e = lddErr as { stdout?: string; stderr?: string };
        lddOut = (e?.stdout ?? "") + (e?.stderr ?? "");
      }
  
      if (!lddOut.includes("not found")) {
        logger.info("Chrome shared libraries all present — no installation needed");
        return;
      }
  
      const missingLibs = lddOut
        .split("\n")
        .filter((l) => l.includes("not found"))
        .map((l) => l.trim());
  
      logger.warn({ chromePath, missingLibs }, "Chrome missing shared libraries — auto-installing via apt-get");
  
      // Full set of libraries required by headless Chrome on Ubuntu/Debian.
      const CHROME_DEPS = [
        "libglib2.0-0", "libnss3", "libnspr4",
        "libatk1.0-0", "libatk-bridge2.0-0",
        "libcups2", "libdrm2", "libxkbcommon0",
        "libxcomposite1", "libxdamage1", "libxfixes3", "libxrandr2",
        "libgbm1", "libpango-1.0-0", "libcairo2",
        "libasound2", "libatspi2.0-0",
        "libx11-6", "libxcb1", "libxext6", "libxrender1", "libx11-xcb1",
      ].join(" ");
  
      try {
        execSync(`apt-get install -y --no-install-recommends ${CHROME_DEPS}`, {
          encoding: "utf-8",
          timeout: 120_000,
          stdio: "pipe",
        });
        logger.info("Chrome shared libraries installed successfully");
      } catch (aptErr: unknown) {
        const e = aptErr as { stderr?: string; message?: string };
        logger.error(
          { err: e?.stderr ?? e?.message ?? String(aptErr) },
          "apt-get install failed — Chrome scans may continue to fail until libs are present",
        );
      }
    } catch (err) {
      logger.error({ err }, "ensureChromeDependencies — unexpected error (non-fatal)");
    }
  }
  
  const rawPort = process.env["PORT"];
  if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
  
  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);
  
  /**
   * Bind the server to the given port, retrying on EADDRINUSE.
   *
   * Azure App Service (and some other PaaS platforms) can start the new process
   * before the previous one has fully released the port.  Rather than crashing
   * immediately (which triggers another restart and creates a loop), we wait up
   * to MAX_RETRIES × RETRY_DELAY_MS for the port to free up.
   */
  function startListening(port: number, remainingRetries = 8, retryDelayMs = 2000): void {
    const server = app.listen(port);
  
    server.on("listening", () => {
      logger.info({ port }, "Server listening");
      startScanWatchdog();
  
      const scheduleTick = () => {
        void Promise.all([runScheduledCrawls(), runDueCrawlerSessions()]).catch((err) =>
          logger.error({ err }, "Scheduled crawler tick failed"),
        );
      };
  
      // Give Azure's health probe time to receive a fast response before the
      // first scheduler tick starts database and crawler work.
      const initialTimer = setTimeout(scheduleTick, 30_000);
      initialTimer.unref();
  
      const timer = setInterval(scheduleTick, 60_000);
      timer.unref();
    });
  
    server.on("error", (err: NodeJS.ErrnoException) => {
      server.close();
      if (err.code === "EADDRINUSE") {
        if (remainingRetries > 0) {
          logger.warn(
            { port, remainingRetries, retryDelayMs },
            "Port already in use — previous process still shutting down, will retry",
          );
          setTimeout(() => startListening(port, remainingRetries - 1, retryDelayMs), retryDelayMs);
        } else {
          logger.error({ port }, "Port still in use after all retries — giving up");
          process.exit(1);
        }
      } else {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
    });
  }
  
  /**
   * Verify the database accepts writes before starting the server.
   *
   * Azure Database for PostgreSQL automatically switches to read-only mode when
   * storage reaches 95% capacity.  Without this check the server starts silently
   * and every write attempt fails with "cannot execute UPDATE in a read-only
   * transaction", causing confusing errors deep in request handlers.
   *
   * The check uses an advisory lock inside a rolled-back transaction so it never
   * modifies any data.  If the DB is read-only the advisory lock call itself will
   * fail, which we catch and re-throw with an actionable message.
   */
  async function checkDatabaseWritable(): Promise<void> {
    const client = await pool.connect();
    try {
      // pg_try_advisory_lock requires write access and fails immediately on a
      // read-only server — it never touches user tables but does prove writability.
      await client.query("BEGIN");
      await client.query("SELECT pg_try_advisory_lock(1234567890)");
      await client.query("ROLLBACK");
      logger.info("Database writability check passed");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("read-only transaction") || msg.includes("read only")) {
        logger.fatal(
          { err },
          "DATABASE IS READ-ONLY — the server will start but ALL writes will fail. " +
          "Fix on Azure: (1) Open Azure portal → your PostgreSQL server → Storage → " +
          "check usage; if ≥ 95% increase allocated storage or delete data. " +
          "(2) Verify DATABASE_URL uses the PRIMARY server hostname, not a " +
          "*.read.postgres.database.azure.com replica endpoint.",
        );
        // Do not exit — read-only API responses (auth, scan results, reports)
        // still work; only writes are blocked.  Operators can fix storage and
        // restart without losing the running process unnecessarily.
      } else {
        throw err;
      }
    } finally {
      client.release();
    }
  }

startListening(port);
runStartupMigrations()
  .then(() => checkDatabaseWritable())
  .then(() => Promise.all([seedDefaultAdmin(), ensureChromeDependencies()]))
  .then(() => recoverOrphanedScans())
  .then(() => recoverAIAssessments())
  .then(() => resumeOrphanedCrawlerSessions())
  .catch((err) => {
    logger.error({ err }, "Startup failed");
    process.exit(1);
  });
