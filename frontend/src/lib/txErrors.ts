import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from 'viem'

/** Turn a failed contract call into one sentence a bidder can act on. */
export function describeTxError(error: unknown, networkName: string): string {
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001)
    if (rejected) return 'You cancelled the transaction in MetaMask.'

    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const reason = revert.reason ?? revert.data?.errorName
      return reason ? `The contract refused: ${reason}.` : 'The contract refused this transaction.'
    }

    if (error.walk((e) => e instanceof InsufficientFundsError)) {
      return `Not enough ${networkName} ETH to cover this and the gas fee.`
    }
    return error.shortMessage
  }
  if (error instanceof Error && /user rejected|user denied/i.test(error.message)) {
    return 'You cancelled the transaction in MetaMask.'
  }
  return error instanceof Error ? error.message : 'Something went wrong with the transaction.'
}
