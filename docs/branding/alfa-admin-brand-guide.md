# Guía de marca de ALFA-Admin

## Posicionamiento

ALFA-Admin es el centro de control, seguridad y administración de ALFA-RMS. Comparte con ALFA-RMS el símbolo modular en forma de “A”, la geometría y la paleta. Su aplicación usa más grafito y reserva el lima para estados saludables y acentos de alto valor.

## Nombre y descriptor

- Nombre comercial: **ALFA-Admin**.
- Wordmark: **ALFA-ADMIN**.
- Descriptor: **Control Center**.
- Descripción: **Centro de control de ALFA-RMS**.

## Logo y variantes

- `public/alfa-admin-logo.svg`: wordmark para fondos claros.
- `public/alfa-admin-logo-inverse.svg`: wordmark para fondos oscuros.
- `public/alfa-admin-mark.svg`: símbolo para fondos claros.
- `public/alfa-admin-mark-inverse.svg`: símbolo para fondos oscuros.
- `public/favicon.svg`: icono de aplicación sobre grafito.

El símbolo no debe reconstruirse, inclinarse, deformarse ni recolorearse fuera de las variantes aprobadas. Su tamaño mínimo es 16 px; el wordmark se usa a partir de 120 px de ancho. Conserva un área libre mínima equivalente a una cuarta parte de la altura del símbolo.

## Paleta

| Función | Color |
| --- | --- |
| Grafito principal | `#132124` |
| Grafito profundo | `#0B1618` |
| Turquesa principal | `#00A7A0` |
| Turquesa hover | `#008C87` |
| Turquesa suave | `#DDF6F3` |
| Lima de acento | `#B8E336` |
| Fondo general | `#F4F7F6` |
| Superficie | `#FFFFFF` |
| Borde | `#DDE6E4` |
| Texto principal | `#172624` |
| Texto secundario | `#60716E` |

El turquesa identifica acciones, selección y navegación. El lima comunica plataforma activa o salud; no se usa como color de botones. Rojo, ámbar, verde y azul mantienen su función semántica para errores, advertencias, éxito e información.

Sobre fondos turquesa se usa `#061011` (`--brand-on-primary`) como texto o icono. La combinación alcanza contraste AA tanto en el estado normal como en hover; el blanco se reserva para fondos de grafito.

## Tipografía

La familia principal es Sora, con Inter y `system-ui` como alternativas. Se favorecen jerarquías compactas, títulos entre 700 y 800, cuerpo entre 400 y 600, y espaciado amplio solo en etiquetas cortas en mayúsculas.

## Componentes y dashboards

- Las superficies usan fondo blanco, borde neutro y sombra discreta.
- Los controles incluyen hover, foco visible, disabled y loading.
- El foco utiliza `--brand-focus-ring` y no depende únicamente del color.
- Los gráficos consumen `src/theme/chartColors.ts`; no repiten HEX en componentes.
- Errores y acciones destructivas conservan rojo; las advertencias conservan ámbar.
- El sidebar usa grafito profundo, selección turquesa y contraste AA.

## Variables CSS

La fuente única está en `src/styles/brand.css`: `--brand-primary`, `--brand-primary-hover`, `--brand-on-primary`, `--brand-primary-soft`, `--brand-accent`, `--brand-sidebar`, `--brand-sidebar-deep`, `--brand-background`, `--brand-surface`, `--brand-border`, `--brand-text`, `--brand-text-muted` y `--brand-focus-ring`.

## Usos incorrectos

- No usar gradientes complejos, volumen 3D o sombras decorativas en el logo.
- No sustituir el símbolo por nubes, engranajes, escudos o carritos.
- No usar lima en grandes superficies o acciones primarias.
- No presentar “Super Admin” como nombre del producto.
- No reutilizar marcas comerciales heredadas en superficies visibles.
