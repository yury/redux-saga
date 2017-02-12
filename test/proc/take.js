import test from 'tape';
import proc from '../../src/internal/proc'
import { createStdChannel, channel, END } from '../../src/internal/channel'
import * as io from '../../src/effects'

test('processor take from default channel', assert => {
  assert.plan(1);

  const typeSymbol = Symbol('action-symbol');
  const stdChannel = createStdChannel()

  let actual = [];

  function* genFn() {
    try {
      actual.push( yield io.take() ) // take all actions
      actual.push( yield io.take('action-1') ) // take only actions of type 'action-1'
      actual.push( yield io.take(['action-2', 'action-2222']) ) // take either type
      actual.push( yield io.take(a => a.isAction) ) // take if match predicate
      actual.push( yield io.take(['action-3', a => a.isMixedWithPredicate]) ) // take if match any from the mixed array
      actual.push( yield io.take(['action-3', a => a.isMixedWithPredicate]) ) // take if match any from the mixed array
      actual.push( yield io.take(typeSymbol) ) // take only actions of a Symbol type
      actual.push( yield io.take('never-happening-action') ) //  should get END
    } finally {
      actual.push('auto ended')
    }
  }

  proc(genFn(), stdChannel).done.catch(err => assert.fail(err))

  Promise.resolve(1)
      .then(() => stdChannel.put({type: 'action-*'}))
      .then(() => stdChannel.put({type: 'action-1'}))
      .then(() => stdChannel.put({type: 'action-2'}))
      .then(() => stdChannel.put({type: 'unnoticeable-action'}))
      .then(() => stdChannel.put({isAction: true}))
      .then(() => stdChannel.put({isMixedWithPredicate: true}))
      .then(() => stdChannel.put({type: 'action-3'}))
      .then(() => stdChannel.put({type: typeSymbol}))
      .then(() => stdChannel.put({...END, timestamp: Date.now()})) // see #316
      .then(() => {
        const expected = [{type: 'action-*'}, {type: 'action-1'}, {type: 'action-2'}, {isAction: true},
          {isMixedWithPredicate: true}, {type: 'action-3'}, {type: typeSymbol}, 'auto ended'];

        assert.deepEqual(actual, expected,
          "processor must fullfill take Effects from default channel"
        );
        assert.end();
      })
});

test('processor take from provided channel', assert => {
  assert.plan(1);

  const chan = channel()
  let actual = [];

  Promise.resolve()
    .then(() => chan.put(1))
    .then(() => chan.put(2))
    .then(() => chan.put(3))
    .then(() => chan.put(4))
    .then(() => chan.close())


  function* genFn() {
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
  }

  proc(genFn()).done.catch(err => assert.fail(err))

  const expected = [1, 2, 3, 4, END, END];

  setTimeout(() => {
    assert.deepEqual(actual, expected,
      "processor must fullfill take Effects from a provided channel"
    );
    assert.end();
  }, 0)

});
