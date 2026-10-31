import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from 'viem'

/** What each DutchAuction custom error means for the person using the page. */
const CONTRACT_ERRORS: Record<string, string> = {
  NotStarted: 'The auction has not started yet.',
  AlreadyStarted: 'The auction has already started.',
  AuctionEnded: 'Bidding has closed: the 20 minutes are over.',
  SoldOut: 'Bidding has closed: the supply is sold out.',
  ZeroBid: 'Enter an amount above 0 ETH.',
  AuctionStillRunning: 'The auction is still running. It can be finalized once it sells out or time is up.',
  AlreadyFinalized: 'The auction has already been finalized.',
  NotFinalized: 'Claims open once the auction is finalized.',
  NothingToClaim: 'This wallet has nothing to claim: it did not bid, or it already claimed.',
  NothingToWithdraw: 'There are no proceeds to withdraw yet.',
  EthTransferFailed: 'Sending ETH to your wallet failed.',
  OwnableUnauthorizedAccount: 'Only the contract owner can do this.',
  ReentrancyGuardReentrantCall: 'This call was blocked by the reentrancy guard.',
}

/** "AuctionStillRunning" -> "Auction still running" for errors not in the list. */
const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** Turn a failed contract call into one sentence a bidder can act on. */
export function describeTxError(error: unknown, networkName: string): string {
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001)
    if (rejected) return 'You cancelled the transaction in MetaMask.'

    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name) return CONTRACT_ERRORS[name] ?? `The contract refused: ${humanize(name)}.`
      return revert.reason ? `The contract refused: ${revert.reason}.` : 'The contract refused this transaction.'
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
