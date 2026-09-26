# Reversible migration and rollback

Before routing traffic to a migrated path, record the legacy behavior and tests, identify an existing route/feature-flag boundary, and define the rollback action. Keep the legacy path deployable through the initial rollout unless its removal is explicitly authorized. Prefer a reversible, bounded slice over an application-wide rewrite.

State what can be switched back without changing persisted product data; preserve compatible data contracts and a tested package/lockfile baseline. Define health/rollback criteria from the application's actual telemetry and product flow rather than inventing universal thresholds. Verify the rollback path locally where possible. Do not deploy, change flags in a live environment, or remove legacy code without authorization. Report untested rollback assumptions honestly.
