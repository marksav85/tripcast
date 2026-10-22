import { useAuth } from '../auth/context.js';
export default function AuthAvailability() {
  const { error } = useAuth();
  return error ? (
    <output className="px-6 py-2 text-center">{error} Public weather remains available.</output>
  ) : null;
}
