-- Run this once against the installed IV database after importing the clean-install file.
-- This updates only the seeded superadmin account.
UPDATE `users`
SET `password` = '$2b$12$/K97p1c6hX.5RXy9SveKnuXUgmq1ytipbh/SLmH51DaSo0CtjStoO'
WHERE `email` = 'superadmin@ivsquarestructure.com'
  AND `role` = 'superadmin';
