-- Unit 1 material-key collation repair; not a clean-install/reset script.
-- Existing coil records and all other columns are retained.
-- For the current Unit 1 schema: material_type VARCHAR(20), nullable, default NULL.
USE `u436685010_iv1_app`;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `coils`
  MODIFY COLUMN `material_type` VARCHAR(20)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;

-- Verify the previously failing comparison without changing production data.
SELECT COUNT(*) AS matching_coils
FROM `coils` c
JOIN `unit1_material_densities` d ON d.material_type = c.material_type;
