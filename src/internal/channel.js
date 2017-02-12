import { is, check, remove, MATCH, internalErr, SAGA_ACTION, sym } from './utils'
import {buffers} from './buffers'
import { asap } from './scheduler'

const CHANNEL_END_TYPE = '@@redux-saga/CHANNEL_END'
const PERSISTENT = sym('PERSISTENT')
export const END = {type: CHANNEL_END_TYPE}
export const isEnd = a => a && a.type === CHANNEL_END_TYPE

const persistent = taker => {
  taker[PERSISTENT] = true
  return taker
}

export const INVALID_BUFFER = 'invalid buffer passed to channel factory function'
export let UNDEFINED_INPUT_ERROR = 'Saga was provided with an undefined action'

if(process.env.NODE_ENV !== 'production') {
  UNDEFINED_INPUT_ERROR += `\nHints:
    - check that your Action Creator returns a non-undefined value
    - if the Saga was started using runSaga, check that your subscribe source provides the action to its listeners
  `
}

export function channel(buffer = buffers.fixed()) {
  let closed = false
  let takers = []

  check(buffer, is.buffer, INVALID_BUFFER)

  function checkForbiddenStates() {
    if(closed && takers.length) {
      throw internalErr('Cannot have a closed channel with pending takers')
    }
    if(takers.length && !buffer.isEmpty()) {
      throw internalErr('Cannot have pending takers with non empty buffer')
    }
  }

  function checkInput(input) {
    checkForbiddenStates()
    check(input, is.notUndef, UNDEFINED_INPUT_ERROR)
    if (closed) {
      return false
    }
    if (!takers.length) {
      buffer.put(input)
      return false
    }
    return true
  }

  function put(input) {
    if (!checkInput(input)) {
      return
    }
    for (var i = 0; i < takers.length; i++) {
      const cb = takers[i]
      if(!cb[MATCH] || cb[MATCH](input)) {
        if (!cb[PERSISTENT]) {
          takers.splice(i, 1)
        }
        return cb(input)
      }
    }
  }

  function broadcast(input) {
    if (!checkInput(input)) {
      return
    }
    const arr = takers.slice()
    takers = []
    for (var i = 0; i < arr.length; i++) {
      const cb = arr[i]
      if(!cb[MATCH] || cb[MATCH](input)) {
        if (!cb[PERSISTENT]) {
          arr.splice(i, 1)
          i-- // step down, as takers changed
        }
        cb(input)
      }
    }
    takers = arr.concat(takers)
  }

  function take(cb) {
    checkForbiddenStates()
    check(cb, is.func, 'channel.take\'s callback must be a function')

    if(closed && buffer.isEmpty()) {
      cb(END)
    } else if(!buffer.isEmpty()) {
      cb(buffer.take())
    } else {
      takers.push(cb)
      cb.cancel = () => remove(takers, cb)
    }
  }

  function flush(cb) {
    checkForbiddenStates()
    check(cb, is.func, 'channel.flush\' callback must be a function')
    if (closed && buffer.isEmpty()) {
      cb(END)
      return
    }
    cb(buffer.flush())
  }

  function close() {
    checkForbiddenStates()
    if(!closed) {
      closed = true
      if(takers.length) {
        const arr = takers
        takers = []
        for (let i = 0, len = arr.length; i < len; i++) {
          arr[i](END)
        }
      }
    }
  }

  return {take, put, broadcast, flush, close,
    get __takers__() { return takers },
    get __closed__() { return closed }
  }
}

export function multicastChannel(buffer) {
  const chan = channel(buffer)
  return {
    ...chan,
    put: chan.broadcast
  }
}

export function eventChannel(subscribe, buffer = buffers.none(), matcher) {
  /**
    should be if(typeof matcher !== undefined) instead?
    see PR #273 for a background discussion
  **/
  if(arguments.length > 2) {
    check(matcher, is.func, 'Invalid match function passed to eventChannel')
  }

  function checkInput(input) {
    if(isEnd(input)) {
      chan.close()
      return false
    }
    if(matcher && !matcher(input)) {
      return false
    }
    return true
  }

  const chan = channel(buffer)
  const emit = input => {
    if (!checkInput(input)) {
      return
    }
    chan.put(input)
  }
  const broadcast = input => {
    if (!checkInput(input)) {
      return
    }
    chan.broadcast(input)
  }
  const unsubscribe = subscribe(emit, broadcast)

  if(!is.func(unsubscribe)) {
    throw new Error('in eventChannel: subscribe should return a function to unsubscribe')
  }

  return {
    take: chan.take,
    flush: chan.flush,
    close: () => {
      if(!chan.__closed__) {
        chan.close()
        unsubscribe()
      }
    }
  }
}

export function actionChannel(stdChannel, match, buffer) {
  const chan = channel(buffer)

  const taker = persistent(chan.put)
  stdChannel.take(taker, match)

  const unsubscribe = () => remove(stdChannel.__takers__, taker)

  return {
    take: chan.take,
    flush: chan.flush,
    close: () => {
      if(!chan.__closed__) {
        chan.close()
        unsubscribe()
      }
    }
  }
}

export const createStdChannel = () => {
  // could be remade to let emit = broadcast => input =>
  // and override it once broadcast is applied
  let broadcast
  const emit = input => {
    if (input[SAGA_ACTION]) {
      broadcast(input)
      return
    }
    asap(() => broadcast(input))
  }
  const chan = eventChannel((_, _broadcast) => {
    broadcast = _broadcast
    return () => chan.close()
  })

  return {
    ...chan,
    take(cb, matcher) {
      if(arguments.length > 1) {
        check(matcher, is.func, 'stdChannel.take\'s matcher argument must be a function')
        cb[MATCH] = matcher
      }
      chan.take(cb)
    },
    put: emit
  }
}
