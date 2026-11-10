-- ADMINISTRATIVE ONE-SHOT SQL: NOT REENTRANT. Specific target/operation approval required.
-- Already applied in the validated shared environment. Do not replay; review README first.
-- PROPOSAL ONLY: explicit authorization separate from the migration package.
-- Passwords are entered interactively with \password; never paste them in SQL/Git/chat.
\set ON_ERROR_STOP on
\if :{?PL09_AUTHORIZED}
\else
  SELECT CAST('PL09_APPROVAL_REQUIRED' AS integer);
\endif
\if :PL09_AUTHORIZED
\else
  SELECT CAST('PL09_APPROVAL_REQUIRED' AS integer);
\endif
BEGIN;
SET LOCAL createrole_self_grant='';
CREATE ROLE pl_web_inicio LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_web_docente LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_web_informes LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_web_seguimiento LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_web_lectura_seguimiento LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE pl_web_incidencias LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT pl_ep04_executor TO pl_web_inicio WITH INHERIT TRUE, SET TRUE;
GRANT pl_s41_docente_executor TO pl_web_docente WITH INHERIT TRUE, SET TRUE;
GRANT pl_s42_executor TO pl_web_informes WITH INHERIT TRUE, SET TRUE;
GRANT pl_ep05_executor TO pl_web_seguimiento WITH INHERIT TRUE, SET TRUE;
GRANT pl_ep05_read_executor TO pl_web_lectura_seguimiento WITH INHERIT TRUE, SET TRUE;
GRANT pl_ep06_executor TO pl_web_incidencias WITH INHERIT TRUE, SET TRUE;
\password pl_web_inicio
\password pl_web_docente
\password pl_web_informes
\password pl_web_seguimiento
\password pl_web_lectura_seguimiento
\password pl_web_incidencias
COMMIT;
