import { z } from 'zod';

const configSchema = z.object({
  SESSION_CLEANUP_INTERVAL_SECONDS: z.coerce.number().min(60).default(3600),
});

console.log('Test 1: Valid value (3600)');
const result1 = configSchema.safeParse({ SESSION_CLEANUP_INTERVAL_SECONDS: 3600 });
console.log('Success:', result1.success, 'Value:', result1.success ? result1.data.SESSION_CLEANUP_INTERVAL_SECONDS : 'N/A');

console.log('\nTest 2: Valid value (60 - minimum)');
const result2 = configSchema.safeParse({ SESSION_CLEANUP_INTERVAL_SECONDS: 60 });
console.log('Success:', result2.success, 'Value:', result2.success ? result2.data.SESSION_CLEANUP_INTERVAL_SECONDS : 'N/A');

console.log('\nTest 3: Invalid value (30 - too small)');
const result3 = configSchema.safeParse({ SESSION_CLEANUP_INTERVAL_SECONDS: 30 });
console.log('Success:', result3.success);
if (!result3.success) {
  console.log('Error:', result3.error.issues[0].message);
}

console.log('\nTest 4: Invalid value (1 - too small)');
const result4 = configSchema.safeParse({ SESSION_CLEANUP_INTERVAL_SECONDS: 1 });
console.log('Success:', result4.success);
if (!result4.success) {
  console.log('Error:', result4.error.issues[0].message);
}

console.log('\nTest 5: Default value (no value provided)');
const result5 = configSchema.safeParse({});
console.log('Success:', result5.success, 'Value:', result5.success ? result5.data.SESSION_CLEANUP_INTERVAL_SECONDS : 'N/A');

console.log('\nTest 6: String coercion (120 as string)');
const result6 = configSchema.safeParse({ SESSION_CLEANUP_INTERVAL_SECONDS: "120" });
console.log('Success:', result6.success, 'Value:', result6.success ? result6.data.SESSION_CLEANUP_INTERVAL_SECONDS : 'N/A');
