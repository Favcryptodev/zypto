// Trusted, version-controlled application configuration.
// A future reviewed release must verify the on-chain deployment before replacing
// this pending state. Never populate it from browser storage, URLs, or form data.
const receiverDeployment = Object.freeze({
  chainId: 1,
  status: 'awaiting-deployment',
  receiver: null,
  label: 'To be deployed',
  transactionsEnabled: false,
});

export const TRANSACTION_LOCK_MESSAGE = 'Receiver deployment is not verified. Updates, processing, approvals and signing are disabled. Wallet connection and read-only refresh remain available.';

export function getReceiverDeployment() {
  return receiverDeployment;
}

// This release deliberately contains no financial execution path. Future
// activation requires a reviewed application update, not a client-side toggle.
export function denyTransactionAction() {
  return Object.freeze({ allowed: false, reason: TRANSACTION_LOCK_MESSAGE });
}
