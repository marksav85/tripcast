export default function Header({ compact = false }) {
  if (compact) return <header className="w-full border-b bg-white px-6 py-4">
    <div className="max-w-5xl mx-auto flex items-center gap-3 text-sky-800">
      <h1 className="text-xl font-bold tracking-tight">TripCast</h1>
      <p className="text-sm text-slate-600">Your travel weather companion</p>
    </div>
  </header>;
  return (
    <header className="w-full bg-blue-600 text-white p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-2">My Travel App</h1>
        <p className="text-lg font-light">
          The 3 W&apos;s of travelling: Where, When and Weather
        </p>
      </div>
    </header>
  );
}
