import { useSupportSettings } from '@/hooks/useSupportSettings';

export default function MaintenancePage() {
  const support = useSupportSettings();
  const supportUrl = support.whatsappUrl || support.telegramUrl || '';

  return (
    <main className="min-h-[100dvh] bg-slate-950 flex items-center justify-center px-5 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-purple-400/20 bg-slate-900 p-6 text-center shadow-2xl sm:p-10" aria-labelledby="maintenance-title">
        <img src="/TALLYAPPLOGO.png" alt="TallyStore" className="mx-auto mb-6 h-20 w-20 rounded-2xl" />
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-purple-300">TallyStore</p>
        <h1 id="maintenance-title" className="text-3xl font-bold tracking-tight">Scheduled maintenance</h1>
        <p className="mt-4 leading-relaxed text-slate-300">
          Purchases and new payment requests are paused while we update the store.
          We’ll reopen after our checks are complete.
        </p>
        <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-400/5 p-4 text-left">
          <h2 className="font-semibold text-amber-200">Already made a payment?</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Keep your receipt and payment reference. Processing may be delayed during maintenance.
            Contact support if you need help with a payment or an existing order.
          </p>
        </div>
        {supportUrl && (
          <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-purple-500 px-6 py-3 font-semibold text-white hover:bg-purple-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple-300">
            Contact support
          </a>
        )}
      </section>
    </main>
  );
}
