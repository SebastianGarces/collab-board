# Shared Types Package Rules

## Purpose

This package contains type definitions and constants shared between frontend and backend. No runtime logic, no Zod schemas (yet), no side effects.

## Export Conventions

- All exports are **named exports**. No default exports.
- `index.ts` re-exports everything via `export * from "./auth"` and `export * from "./collab"`.
- `package.json` exposes sub-path exports: `@collab/shared/collab` and `@collab/shared/auth`.

## Type Naming

- Types and interfaces: PascalCase (`BoardElement`, `PresenceState`, `AuthUser`).
- Constants: SCREAMING_SNAKE_CASE (`WS_MESSAGE_SYNC`, `STICKY_NOTE_COLORS`).
- Properties: camelCase (`senderClientId`, `sentAtMs`).
- Element type strings: kebab-case (`"sticky-note"`, `"rectangle"`).

## Board Element Type System

- **Discriminated union** on the `type` field.
- `BaseElement` defines the common shape: `id`, `type`, `x`, `y`, `width`, `height`.
- Each element type extends `BaseElement` with type-specific fields.
- `BoardElement` is the union of all element interfaces.
- Default sizes are exported as constants: `DEFAULT_STICKY_NOTE_SIZE`, `DEFAULT_RECTANGLE_SIZE`, etc.

## Adding a New Element Type

1. Add the type string to the `ElementType` type.
2. Create an interface extending `BaseElement` with type-specific fields.
3. Add the new interface to the `BoardElement` union.
4. Add a default size constant.
5. Update the frontend's `yMapToElement()` in `use-yjs-elements.ts` to handle the new type.
6. Create a content component in `apps/frontend/src/components/canvas/`.

## WebSocket Protocol Constants

- Message types (`WS_MESSAGE_SYNC`, `WS_MESSAGE_PERF_PROBE`) are defined here and used by both frontend and backend.
- New message types should be added as sequential integers with clear naming.

## Presence Types

- `PresenceUser`: `id`, `name`, `color`.
- `PresenceState`: `user` + optional `cursor`.
- `Cursor`: `x`, `y` world coordinates.

## When to Add Zod Schemas

- Currently no Zod schemas exist in this package.
- When AI tool definitions are added (Layer 2 in build checklist), Zod schemas for tool arguments should live here.
- Zod schemas should mirror the TypeScript types and be exported alongside them.

## Reference Skills

When working in this area, read these skill files for framework best practices:
- `.agents/skills/bun-development/SKILL.md`
