# Línea de base PostgreSQL

Esta migración representa el esquema operativo que ya existía en producción al 13 de julio de 2026. Se registra mediante `prisma migrate resolve --applied` y no debe ejecutarse como DDL sobre producción.

Las migraciones posteriores deben ser incrementales y se desplegarán con `prisma migrate deploy`.
