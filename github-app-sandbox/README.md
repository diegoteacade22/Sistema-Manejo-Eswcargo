# GitHub App Sandbox

Laboratorio aislado para probar proyectos open-source antes de incorporarlos a Company OS o a infraestructura productiva.

## Objetivo

Probar rápido, medir utilidad real y descartar sin contaminar producción.

## Reglas

1. Nada del laboratorio se conecta a producción por defecto.
2. No usar credenciales reales salvo aprobación explícita y secretos separados.
3. Preferir Docker/containers y volúmenes descartables.
4. Cada proyecto entra primero como `CANDIDATE`.
5. Para pasar a `TESTING` debe tener caso de uso concreto y criterio de éxito.
6. Sólo un proyecto con resultado `ADOPT` puede proponerse para integración real.

## Flujo

`CANDIDATE -> REVIEWED -> TESTING -> ADOPT | HOLD | REJECT`

## Métrica rápida

Cada app se puntúa 1-5 en:
- Impacto operativo
- Ahorro de tiempo
- Ahorro/costo
- Madurez
- Seguridad
- Facilidad de integración

## Primeros candidatos

- Headroom — optimización de tokens/contexto.
- Firecrawl — extracción web para pricing/procurement/research.
- Browser Use — automatización de portales sin API.
- Twenty — CRM operativo open source.
- Paperless-ngx — ingestión y archivo de documentos.

El laboratorio comienza deliberadamente simple. Se escala sólo cuando haya una necesidad real.