import { z } from 'zod';

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

export function compactInputSchema(
  schema: z.ZodTypeAny,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const json = z.toJSONSchema(schema, {
    unrepresentable: 'any',
    cycles: 'ref',
  }) as JsonSchema;
  const required = new Set(json.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(json.properties ?? {})) {
    const field = compactField(property);
    shape[key] = required.has(key) ? field : field.optional();
  }

  return z.object(shape);
}

function compactField(schema: JsonSchema): z.ZodTypeAny {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    // `priority: ticketPrioritySchema.optional()` round-trips as
    // anyOf:[{enum:[…]}, {type:"null"}]. The previous code took length 1 as a
    // signal to compact and otherwise demoted to z.unknown(), losing the enum
    // for nullable+optional fields. Hosts then surfaced a free-form string in
    // their UI even though the executor would reject anything not in the set.
    // Strip the null variant and recurse on whatever's left, then re-apply
    // nullable() if the original union admitted null.
    const nonNull = variants.filter((variant) => variant.type !== 'null');
    const hasNull = nonNull.length !== variants.length;
    let field: z.ZodTypeAny;
    if (nonNull.length === 1) {
      field = compactField(nonNull[0] ?? {});
    } else if (nonNull.length > 1) {
      // Multiple non-null shapes (rare in practice). Take a union if all are
      // representable; fall back to unknown only when nothing fits.
      const compacted = nonNull.map((v) => compactField(v ?? {}));
      field =
        compacted.length >= 2
          ? z.union(compacted as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
          : (compacted[0] ?? z.unknown());
    } else {
      field = z.unknown();
    }
    return hasNull ? field.nullable() : field;
  }

  if (
    schema.enum &&
    schema.enum.length > 0 &&
    schema.enum.every((item) => typeof item === 'string')
  ) {
    return z.enum(schema.enum as [string, ...string[]]);
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== 'null')
    : schema.type;
  if (type === 'string') return z.string();
  if (type === 'integer') return z.number().int();
  if (type === 'number') return z.number();
  if (type === 'boolean') return z.boolean();
  if (type === 'array') return z.array(z.unknown());
  if (type === 'object') return z.record(z.string(), z.unknown());
  return z.unknown();
}
