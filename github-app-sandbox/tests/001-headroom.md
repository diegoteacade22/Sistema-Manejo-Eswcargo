# TEST-001 — Headroom

## Objetivo
Medir si Headroom reduce consumo de tokens/contexto sin degradar resultados en un flujo real de agentes.

## Repo
`headroomlabs-ai/headroom`

## Estado
`REVIEWED — listo para instalar en runtime sandbox`

## Caso de prueba inicial
Ejecutar el mismo input de logs/JSON grande dos veces:
1. directo al modelo;
2. pasando por Headroom.

Comparar:
- tokens de entrada;
- tokens ahorrados;
- latencia;
- calidad/respuesta;
- errores o pérdida de información.

## Criterio de aprobación
Adoptar sólo si:
- ahorro >= 20% en tokens en el caso real;
- no aparecen errores funcionales;
- no requiere cambios complejos en los agentes existentes;
- rollback es inmediato.

## Seguridad
Primera prueba sin credenciales ni datos productivos.

## Próximo paso
Instalar Headroom en un contenedor/entorno aislado de la Mac mini y ejecutar benchmark A/B.