import { Type } from "@sinclair/typebox";

/**
 * Strip HTML tags from input text
 */
export function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

// Board name validation
export const BoardNameSchema = Type.String({
  minLength: 1,
  maxLength: 200,
});

// Element text validation (sticky notes, text elements)
export const ElementTextSchema = Type.String({
  maxLength: 5000,
});

// User name validation (presence)
export const UserNameSchema = Type.String({
  minLength: 1,
  maxLength: 100,
});

// Board CRUD request bodies
export const CreateBoardBody = Type.Object({
  name: Type.Optional(BoardNameSchema),
});

export const UpdateBoardBody = Type.Object({
  name: BoardNameSchema,
});
