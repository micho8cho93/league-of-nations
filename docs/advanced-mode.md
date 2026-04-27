# Advanced Mode

## Lite vs Advanced

- `Lite` keeps the existing setup flow and the existing simpler gameplay rules.
- `Advanced` uses the same match structure, but adds terrain-based special resources and resource-gated construction and unit rules.
- Default mode is `lite` for backward compatibility.

## Terrain Resource Mapping

- `grassland -> fruit`
- `jungle -> hardwood`
- `arctic -> iron`
- `desert -> oil`

## Resource Purpose

- `fruit`: drives population growth
- `hardwood`: required for buildings
- `iron`: required for factories
- `oil`: required for advanced units

## Landscape Diversity

Advanced mode uses `settings.landscapeDiversity` with:

- `high`: larger biome regions with guaranteed grassland, jungle, arctic, and desert presence
- `superHigh`: smaller, more scattered biome patches with the same guaranteed biome coverage

Lite mode keeps the previous `Low / Balanced / High` behavior.

## Resource Gates

Only Advanced mode enforces these rules:

- owned grassland tiles produce fruit each round
- owned jungle tiles produce hardwood each round
- owned arctic tiles produce iron each round
- owned desert tiles produce oil each round
- buildings consume hardwood
- factories consume hardwood and iron
- advanced units consume oil
- fruit shortage reduces stability/happiness pressure
- fruit surplus can grow population

Lite mode does not require these extra resources.

## Multiplayer Authority

- match settings include `mode`
- Advanced server validation rejects:
  - building without enough hardwood
  - factory construction without enough hardwood or iron
  - advanced unit deployment without enough oil
  - invalid turn ownership and invalid tile ownership
- Lite multiplayer keeps the legacy action flow and does not reject actions because Advanced-only resources are missing
- client-sent resource or cost spoofing is ignored; the server calculates authoritative costs and results

## Manual Test Checklist

1. Open the home screen and verify the first choice is `Lite` or `Advanced`.
2. Start a Lite bot match and confirm the previous setup/gameplay flow still works without hardwood, iron, oil, or fruit gates.
3. Start an Advanced bot match and confirm the setup screen offers `Landscape Diversity: High / Super High`.
4. Inspect multiple Advanced maps and confirm grassland, jungle, arctic, and desert are all present.
5. Compare Advanced `High` vs `Super High` and confirm `Super High` produces smaller biome patches.
6. In Advanced mode, confirm grassland adds fruit, jungle adds hardwood, arctic adds iron, and desert adds oil.
7. In Advanced mode, confirm a building fails without hardwood and succeeds after adding hardwood.
8. In Advanced mode, confirm a factory fails without iron/hardwood and succeeds after adding both.
9. In Advanced mode, confirm an advanced unit fails without oil and succeeds with oil.
10. In multiplayer, confirm Advanced resource gates are enforced by the server while Lite actions still work without Advanced resources.
