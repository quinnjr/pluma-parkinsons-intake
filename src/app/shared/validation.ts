// Shared regex patterns bound into form inputs.
// The String.raw wrapper preserves the backslash through JS template-literal
// parsing so `<input pattern>` receives `\d{6}` rather than `d{6}`.
export const SIX_DIGIT_PATTERN = String.raw`\d{6}`;
