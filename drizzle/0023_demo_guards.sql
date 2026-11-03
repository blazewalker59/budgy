-- The demo sandbox's boundaries, in the database (docs/adr/0015): a real
-- user can never become a Demo persona or join a Demo Household, a persona
-- can never get a sign-in account or join a real Household, and a
-- Household's demo flag never changes after it is made.
CREATE TRIGGER `demo_persona_is_synthetic`
BEFORE INSERT ON `demo_personas`
WHEN NOT EXISTS (SELECT 1 FROM `user` WHERE `id` = NEW.`id` AND lower(`email`) LIKE '%@demo.invalid')
  OR EXISTS (SELECT 1 FROM `account` WHERE `user_id` = NEW.`id`)
BEGIN
  SELECT RAISE(ABORT, 'Only a demo.invalid user without sign-in can be a Demo persona');
END;
--> statement-breakpoint
CREATE TRIGGER `demo_persona_never_signs_in`
BEFORE INSERT ON `account`
WHEN EXISTS (SELECT 1 FROM `demo_personas` WHERE `id` = NEW.`user_id`)
  OR EXISTS (SELECT 1 FROM `user` WHERE `id` = NEW.`user_id` AND lower(`email`) LIKE '%@demo.invalid')
BEGIN
  SELECT RAISE(ABORT, 'A Demo persona cannot sign in');
END;
--> statement-breakpoint
CREATE TRIGGER `demo_email_is_fixed`
BEFORE UPDATE OF `email` ON `user`
WHEN (lower(OLD.`email`) LIKE '%@demo.invalid') != (lower(NEW.`email`) LIKE '%@demo.invalid')
BEGIN
  SELECT RAISE(ABORT, 'An email cannot move into or out of demo.invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `household_demo_is_fixed`
BEFORE UPDATE OF `demo` ON `households`
WHEN NEW.`demo` IS NOT OLD.`demo`
BEGIN
  SELECT RAISE(ABORT, 'A Household cannot become or stop being a Demo Household');
END;
--> statement-breakpoint
CREATE TRIGGER `household_member_demo_matches`
BEFORE INSERT ON `household_members`
WHEN coalesce((SELECT `demo` FROM `households` WHERE `id` = NEW.`household_id`), 0)
  != EXISTS (SELECT 1 FROM `demo_personas` WHERE `id` = NEW.`member_id`)
BEGIN
  SELECT RAISE(ABORT, 'Only Demo personas join a Demo Household, and only it');
END;
--> statement-breakpoint
CREATE TRIGGER `household_member_demo_matches_update`
BEFORE UPDATE OF `household_id`, `member_id` ON `household_members`
WHEN coalesce((SELECT `demo` FROM `households` WHERE `id` = NEW.`household_id`), 0)
  != EXISTS (SELECT 1 FROM `demo_personas` WHERE `id` = NEW.`member_id`)
BEGIN
  SELECT RAISE(ABORT, 'Only Demo personas join a Demo Household, and only it');
END;
