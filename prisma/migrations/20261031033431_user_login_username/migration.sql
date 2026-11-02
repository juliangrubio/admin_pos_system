-- El identificador de acceso pasa a ser un email O un nombre de usuario (apodo).
-- Se renombra la columna (no se borra y se vuelve a crear) para conservar los usuarios existentes.
ALTER TABLE "User" RENAME COLUMN "email" TO "username";
ALTER INDEX "User_email_key" RENAME TO "User_username_key";
ALTER TABLE "User" RENAME CONSTRAINT "User_email_lowercase_chk" TO "User_username_lowercase_chk";

-- Dos formas válidas, que no se pueden confundir porque el apodo nunca lleva "@":
--  * nombre de usuario: 3 a 30 caracteres (letras minúsculas, números, punto, guion y guion bajo), empezando por letra o número;
--  * email: una sola "@", sin espacios y con un punto en el dominio (la validación fina la hace la aplicación).
ALTER TABLE "User" ADD CONSTRAINT "User_username_format_chk" CHECK (
  "username" ~ '^[a-z0-9][a-z0-9._-]{2,29}$'
  OR ("username" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND length("username") <= 254)
);
