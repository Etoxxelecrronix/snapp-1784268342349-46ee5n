import * as keys from './keys';

/**
 * 💳 STRIPE PAYMENTS — Payment Links (cross-platform: iOS + Android)
 *
 * Sends the user to a Stripe-hosted payment page. No card data ever touches this
 * app, so there is NO PCI burden and nothing sensitive lives in the app.
 *
 * Snapp runs your app in TWO different runtimes:
 *   • iOS     → an HTML bundle inside Safari (browser)  → window.location exists
 *   • Android → native code execution (no browser)      → Linking is provided
 *               ambiently by the Snapp runtime
 * This helper opens the link the right way on each runtime (just like supabase.ts
 * picks the right storage). `typeof` checks never throw, and the branch for the
 * other platform is never executed — so nothing here breaks either build or runtime.
 *
 * Setup (owner, no code): create a Payment Link in the Stripe Dashboard
 * (https://dashboard.stripe.com/payment-links), then in Settings → Environment tap
 * "Add Stripe Payment Link" and paste the URL — the key is named STRIPE_PAYMENT_LINK
 * for you (tap again for more links → STRIPE_PAYMENT_LINK_2, _3). Never hardcode it.
 */
declare const window: any;
declare const Linking: any;

// Collect every injected key whose value is a Stripe payment link. Detecting by
// value (not by an exact key name) lets the owner name the key anything and
// configure several links without breaking the button.
function collectStripeLinks(): Record<string, string> {
  const found: Record<string, string> = {};
  const all = keys as any;
  for (const name of Object.keys(all)) {
    const value = all[name];
    if (
      typeof value === 'string' &&
      /^https?:\/\//.test(value) &&
      (/stripe\.com/.test(value) || /^STRIPE/i.test(name))
    ) {
      found[name] = value;
    }
  }
  return found;
}

/** Every configured Stripe link, keyed by its environment-variable name. */
export const stripePaymentLinks: Record<string, string> = collectStripeLinks();

/** Default link: the one named STRIPE_PAYMENT_LINK if present, else the first found. */
export const stripePaymentLink: string =
  stripePaymentLinks.STRIPE_PAYMENT_LINK || Object.values(stripePaymentLinks)[0] || '';

export interface PaymentLinkOptions {
  /** Use a specific link URL directly. */
  paymentLink?: string;
  /** Or pick a configured link by its env key name, e.g. 'STRIPE_PAYMENT_LINK_2' (when several exist). */
  key?: string;
  /** Supabase user id — sent as client_reference_id so orders can match accounts. */
  userId?: string;
  /** Prefill the buyer's email on the Stripe page. */
  email?: string;
}

/**
 * Open a Stripe-hosted payment page. Works on BOTH iOS and Android.
 * @returns true if a page was opened, false if no link is configured yet.
 */
export function redirectToPaymentLink(opts: PaymentLinkOptions = {}): boolean {
  const base =
    opts.paymentLink ||
    (opts.key ? stripePaymentLinks[opts.key] : '') ||
    stripePaymentLink;
  if (!base) {
    console.warn(
      '[stripe] No Stripe payment link found. Add it with the "Add Stripe Payment Link" button in Settings → Environment.'
    );
    return false;
  }

  let target = base;
  try {
    const url = new URL(base);
    if (opts.userId) url.searchParams.set('client_reference_id', opts.userId);
    if (opts.email) url.searchParams.set('prefilled_email', opts.email);
    target = url.toString();
  } catch (e) {
    // URL not available/invalid — open the link as-is.
  }

  // iOS: the app is an HTML bundle running in a browser → window.location exists.
  // (Android's injected `window` stub has no `location`, so this is iOS-only.)
  if (typeof window !== 'undefined' && window && window.location) {
    let framed = false;
    try {
      framed = window.self !== window.top;
    } catch (e) {
      framed = true;
    }
    if (framed && window.open) {
      window.open(target, '_blank');
    } else {
      window.location.href = target;
    }
    return true;
  }

  // Android: native runtime → Linking is injected ambiently by the Snapp runtime.
  if (typeof Linking !== 'undefined' && Linking && Linking.openURL) {
    Linking.openURL(target);
    return true;
  }

  console.warn('[stripe] Could not open the payment page on this platform.');
  return false;
}
