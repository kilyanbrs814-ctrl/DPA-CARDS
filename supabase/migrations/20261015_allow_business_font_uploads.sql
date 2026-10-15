-- Permit merchants to store their own fonts used ONLY for browser-rendered Apple Wallet headers.
-- Existing 2 MB object cap and image MIME types stay unchanged.
update storage.buckets
set allowed_mime_types=array['image/png','image/jpeg','font/ttf','font/otf','font/woff2']::text[]
where id='program-assets' and allowed_mime_types is not null;
