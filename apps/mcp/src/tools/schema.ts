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
    const nonNull = variants.filter((variant) => variant.type !== 'null');
    const hasNull = nonNull.length !== variants.length;
    const field = nonNull.length === 1 ? compactField(nonNull[0] ?? {}) : z.unknown();
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
