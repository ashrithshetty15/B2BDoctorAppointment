-- Doctor-editable profile fields.
--
-- photo holds a data: URI rather than a path or a URL: the container
-- filesystem is ephemeral, so an uploaded file would vanish on the next
-- redeploy, and no object storage is configured. The browser downscales to a
-- 256px avatar before upload, so the stored value is a few KB.

ALTER TABLE "doctors" ADD COLUMN "specialty" TEXT;
ALTER TABLE "doctors" ADD COLUMN "qualification" TEXT;
ALTER TABLE "doctors" ADD COLUMN "photo" TEXT;
