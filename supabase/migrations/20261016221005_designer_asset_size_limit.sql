-- Match the designer's 15 MiB input limit. A 1032x812 lossless PNG can exceed 2 MiB.
-- Keep existing MIME types, visibility and object authorization policies unchanged.
update storage.buckets
set file_size_limit = 15728640
where id = 'program-assets';
