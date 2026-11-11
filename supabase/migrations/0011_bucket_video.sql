-- allow videos/HEIC and larger files in job-photos (config change, no data removed)
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm']
where id = 'job-photos';
