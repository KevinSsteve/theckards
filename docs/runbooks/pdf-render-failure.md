# PDF preview render failure

1. Check alarm `theckards-prod-jobs-age`, the jobs DLQ and `/theckards/prod/worker` using the agreement/version technical IDs. Never log field content.
2. Confirm the worker service is steady and can read the application DB role, write the documents bucket and use its KMS key.
3. Inspect `agreement_versions.render_error_code`; do not edit immutable title, fields or content hash.
4. Redrive only the affected `pdf.render` envelope after correcting the cause. Rendering is idempotent; an already-ready version is skipped.
5. Verify the resulting S3 object SHA-256 matches `document_sha256` before telling the user the preview is ready.
