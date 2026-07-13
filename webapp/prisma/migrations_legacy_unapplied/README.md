# Migraciones históricas archivadas

Estas migraciones se conservan como referencia y no fueron aplicadas en la base de producción. Las cuatro primeras contienen SQL de SQLite incompatible con PostgreSQL. No deben volver a ejecutarse contra producción.

La migración activa `20260713135000_baseline_production_postgres` establece el punto de inicio canónico para cambios futuros.
