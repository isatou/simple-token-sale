/* eslint-env mocha */
/* global artifacts assert contract */

const HumanStandardToken = artifacts.require('./HumanStandardToken.sol');
const fs = require('fs');
const BN = require('bn.js');
const HttpProvider = require('ethjs-provider-http');
const EthRPC = require('ethjs-rpc');
const EthQuery = require('ethjs-query');

const ethRPC = new EthRPC(new HttpProvider('http://localhost:8545'));
const ethQuery = new EthQuery(new HttpProvider('http://localhost:8545'));

const Sale = artifacts.require('./Sale.sol');
const Filter = artifacts.require('./Filter.sol');

contract('Sale', (accounts) => {
  const preBuyersConf = JSON.parse(fs.readFileSync('./conf/preBuyers.json'));
  const foundersConf = JSON.parse(fs.readFileSync('./conf/founders.json'));
  const saleConf = JSON.parse(fs.readFileSync('./conf/sale.json'));
  const tokenConf = JSON.parse(fs.readFileSync('./conf/token.json'));
  const [owner, james, miguel, edwhale] = accounts;

  let tokensForSale;

  /*
   * Utility Functions
   */

  async function purchaseToken(actor, amount) {
    if (!BN.isBN(amount)) { throw new Error('Supplied amount is not a BN.'); }
    const sale = await Sale.deployed();
    await sale.purchaseTokens({ from: actor, value: amount.mul(saleConf.price) });
  }

  async function getTokenBalanceOf(actor) {
    const sale = await Sale.deployed();
    const tokenAddr = await sale.token.call();
    const token = HumanStandardToken.at(tokenAddr);
    const balance = await token.balanceOf.call(actor);
    return new BN(balance.toString(10), 10);
  }

  function totalPreSoldTokens() {
    const preSoldTokens = Object.keys(preBuyersConf).map(curr =>
      new BN(preBuyersConf[curr].amount, 10));
    return preSoldTokens.reduce((sum, value) => sum.add(new BN(value, 10)), new BN(0, 10));
  }

  function getFounders() {
    return Object.keys(foundersConf.founders);
  }

  function totalFoundersTokens() {
    const foundersTokens = getFounders().map(curr =>
      new BN(foundersConf.founders[curr].amount, 10));
    return foundersTokens.reduce((sum, value) => sum.add(new BN(value, 10)), new BN(0, 10));
  }

  async function getFilter(index) {
    const sale = await Sale.deployed();
    const filterAddr = await sale.filters.call(index);
    return Filter.at(filterAddr);
  }

  function getFoundersAddresses() {
    return getFounders().map(curr =>
      foundersConf.founders[curr].address,
    );
  }

  function isSignerAccessFailure(err) {
    const signerAccessFailure = 'could not unlock signer account';
    return err.toString().includes(signerAccessFailure);
  }

  function isEVMException(err) {
    return err.toString().includes('invalid opcode');
  }

  function forceMine(blockToMine) {
    return new Promise(async (resolve, reject) => {
      if (!BN.isBN(blockToMine)) {
        reject('Supplied block number must be a BN.');
      }
      const blockNumber = await ethQuery.blockNumber();
      if (blockNumber.lt(blockToMine)) {
        ethRPC.sendAsync({ method: 'evm_mine' }, (err) => {
          if (err !== undefined && err !== null) { reject(err); }
          resolve(forceMine(blockToMine));
        });
      } else {
        resolve();
      }
    });
  }

  function as(actor, fn, ...args) {
    function detectSendObject(potentialSendObj) {
      function hasOwnProperty(obj, prop) {
        const proto = obj.constructor.prototype;
        return (prop in obj) &&
       (!(prop in proto) || proto[prop] !== obj[prop]);
      }
      if (typeof potentialSendObj !== 'object') { return undefined; }
      if (
        hasOwnProperty(potentialSendObj, 'from') ||
        hasOwnProperty(potentialSendObj, 'to') ||
        hasOwnProperty(potentialSendObj, 'gas') ||
        hasOwnProperty(potentialSendObj, 'gasPrice') ||
        hasOwnProperty(potentialSendObj, 'value')
      ) {
        throw new Error('It is unsafe to use "as" with custom send objects');
      }
      return undefined;
    }
    detectSendObject(args[args.length - 1]);
    const sendObject = { from: actor };
    return fn(...args, sendObject);
  }

  before(() => {
    const tokensPreAllocated = totalPreSoldTokens().add(totalFoundersTokens());
    saleConf.price = new BN(saleConf.price, 10);
    saleConf.startBlock = new BN(saleConf.startBlock, 10);
    tokenConf.initialAmount = new BN(tokenConf.initialAmount, 10);
    tokensForSale = tokenConf.initialAmount.sub(tokensPreAllocated);
  });

  describe('Initial token issuance', () => {
    const wrongTokenBalance = 'has an incorrect token balance.';
    it('should instantiate preBuyers with the proper number of tokens', () => {
      Promise.all(
        Object.keys(preBuyersConf).map(async (curr) => {
          const tokenBalance =
            await getTokenBalanceOf(preBuyersConf[curr].address);
          const expected = preBuyersConf[curr].amount;
          const errMsg = `A pre-buyer ${wrongTokenBalance}`;
          assert.strictEqual(
            tokenBalance.toString(10), expected.toString(10), errMsg,
          );
        }),
      );
    });
    it('should instantiate disburser contracts with the proper number of tokens', () => {
      const totalDisbursers =
        new BN(Object.keys(foundersConf.vestingDates).length, 10);
      Promise.all(
        Object.keys(foundersConf.vestingDates).map(async (curr, i) => {
          const filter = await getFilter(i);
          const disburserAddr = await filter.disburser.call();
          const tokenBalance = await getTokenBalanceOf(disburserAddr);
          const expected = totalFoundersTokens().div(totalDisbursers);
          const errMsg = `A disburser contract ${wrongTokenBalance}`;
          assert.strictEqual(
            tokenBalance.toString(10), expected.toString(10), errMsg,
          );
        }),
      );
    });
    it('should instantiate the public sale with the total supply of tokens ' +
       'minus the sum of tokens pre-sold.', async () => {
      const tokenBalance = await getTokenBalanceOf(Sale.address);
      const expected = tokensForSale.toString(10);
      const errMsg = `The sale contract ${wrongTokenBalance}`;
      assert.strictEqual(
        tokenBalance.toString(10), expected.toString(10), errMsg,
      );
    });
  });
  describe('Instantiation', () => {
    const badInitialization = 'was not initialized properly';
    it(`should instantiate with the price set to ${saleConf.price} Wei.`, async () => {
      const sale = await Sale.deployed();
      const price = await sale.price.call();
      const expected = saleConf.price;
      const errMsg = `The price ${badInitialization}`;
      assert.strictEqual(price.toString(10), expected.toString(10), errMsg);
    });
    it(`should instantiate with the owner set to ${saleConf.owner}.`, async () => {
      const sale = await Sale.deployed();
      const actualOwner = await sale.owner.call();
      const expected = saleConf.owner.toLowerCase();
      const errMsg = `The owner ${badInitialization}`;
      assert.strictEqual(actualOwner.valueOf(), expected, errMsg);
    });
    it(`should instantiate with the wallet set to ${saleConf.wallet}.`, async () => {
      const sale = await Sale.deployed();
      const wallet = await sale.wallet.call();
      const expected = saleConf.wallet;
      const errMsg = `The wallet ${badInitialization}`;
      assert.strictEqual(wallet.valueOf(), expected.toLowerCase(), errMsg);
    });
    it(`should instantiate with the startBlock set to ${saleConf.startBlock}.`, async () => {
      const sale = await Sale.deployed();
      const startBlock = await sale.startBlock.call();
      const expected = saleConf.startBlock;
      const errMsg = `The start block ${badInitialization}`;
      assert.strictEqual(
        startBlock.toString(10), expected.toString(10), errMsg,
      );
    });
  });

  describe('Owner-only functions', () => {
    const nonOwnerAccessError = 'A non-owner was able to';
    const ownerAccessError = 'An owner was unable able to';
    it('should not allow a non-owner to change the price.', async () => {
      const sale = await Sale.deployed();
      try {
        await as(james, sale.changePrice, saleConf.price + 1);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const price = await sale.price.call();
      const expected = saleConf.price;
      const errMsg = `${nonOwnerAccessError} change the price`;
      assert.strictEqual(price.toString(10), expected.toString(10), errMsg);
    });
    it('should not allow a non-owner to change the startBlock.', async () => {
      const sale = await Sale.deployed();
      try {
        await as(james, sale.startBlock, saleConf.startBlock + 1);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const startBlock = await sale.startBlock.call();
      const expected = saleConf.startBlock;
      const errMsg = `${nonOwnerAccessError} change the start block`;
      assert.strictEqual(startBlock.toString(10), expected.toString(10), errMsg);
    });
    it('should not allow a non-owner to change the owner', async () => {
      const sale = await Sale.deployed();
      try {
        await as(james, sale.owner, james);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const actualOwner = await sale.owner.call();
      const expected = saleConf.owner.toLowerCase();
      const errMsg = `${nonOwnerAccessError} change the owner`;
      assert.strictEqual(actualOwner.toString(), expected.toString(), errMsg);
    });
    it('should not allow a non-owner to change the wallet', async () => {
      const sale = await Sale.deployed();
      try {
        await as(james, sale.wallet, james);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const wallet = await sale.wallet.call();
      const expected = saleConf.wallet;
      const errMsg = `${nonOwnerAccessError} change the wallet`;
      assert.strictEqual(wallet.toString(), expected.toLowerCase(), errMsg);
    });
    it('should not allow a non-owner to activate the emergencyToggle', async () => {
      const sale = await Sale.deployed();
      try {
        await as(james, sale.emergencyToggle);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const emergencyFlag = await sale.emergencyFlag.call();
      const expected = false;
      const errMsg = `${nonOwnerAccessError} change the emergencyToggle`;
      assert.strictEqual(emergencyFlag, expected, errMsg);
    });
    it('should change the owner to miguel.', async () => {
      const sale = await Sale.deployed();
      await as(saleConf.owner, sale.changeOwner, miguel);
      const actualOwner = await sale.owner.call();
      const expected = miguel;
      const errMsg = `${ownerAccessError} change the owner`;
      assert.strictEqual(actualOwner, expected, errMsg);
      await as(miguel, sale.changeOwner, saleConf.owner);
    });
    it('should change the price to 2666.', async () => {
      const sale = await Sale.deployed();
      await as(owner, sale.changePrice, 2666);
      const price = await sale.price.call();
      const expected = 2666;
      const errMsg = `${ownerAccessError} change the price`;
      assert.strictEqual(price.toString(10), expected.toString(10), errMsg);
      await as(owner, sale.changePrice, saleConf.price);
    });
    it('should change the startBlock to 2666.', async () => {
      const sale = await Sale.deployed();
      await as(owner, sale.changeStartBlock, 2666);
      const price = await sale.startBlock.call();
      const expected = 2666;
      const errMsg = `${ownerAccessError} change the start block`;
      assert.strictEqual(price.toString(10), expected.toString(10), errMsg);
      await as(owner, sale.changeStartBlock, saleConf.startBlock);
    });
    it('should change the wallet address', async () => {
      const newWallet = '0x0000000000000000000000000000000000000001';
      const sale = await Sale.deployed();
      await as(owner, sale.changeWallet, newWallet);
      const wallet = await sale.wallet.call();
      const expected = newWallet;
      const errMsg = `${ownerAccessError} change the wallet address`;
      assert.strictEqual(wallet, expected, errMsg);
      await as(owner, sale.changeWallet, saleConf.wallet);
    });
    it('should activate the emergencyFlag.', async () => {
      const sale = await Sale.deployed();
      await as(owner, sale.emergencyToggle);
      const emergencyFlag = await sale.emergencyFlag.call();
      const expected = true;
      const errMsg = `${ownerAccessError} set the emergency toggle`;
      assert.strictEqual(emergencyFlag.valueOf(), expected, errMsg);
      await as(owner, sale.emergencyToggle);
    });
  });

  describe('Pre-sale period', () => {
    const earlyPurchaseError = ' was able to purchase tokens early';
    it('should reject a purchase from James.', async () => {
      const startingBalance = await getTokenBalanceOf(james);
      try {
        await purchaseToken(james, new BN('420', 10));
        const errMsg = james + earlyPurchaseError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(james);
      const expected = startingBalance;
      const errMsg = james + earlyPurchaseError;
      assert.equal(
        finalBalance.toString(10), expected.toString(10), errMsg,
      );
    });
  });

  describe('Sale period 0', () => {
    const balanceError = 'A balance was not as expected following a purchase';

    before(async () =>
      forceMine(saleConf.startBlock),
    );

    it('should not allow the owner to change the price', async () => {
      const sale = await Sale.deployed();
      try {
        await as(owner, sale.changePrice, saleConf.price + 1);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const price = await sale.price.call();
      const expected = saleConf.price;
      const errMsg = 'The owner was able to change the price after the freeze block';
      assert.strictEqual(price.toString(10), expected.toString(10), errMsg);
    });
    it('should transfer 1 token to James.', async () => {
      const startingBalance = await getTokenBalanceOf(james);
      const purchaseAmount = new BN('1', 10);
      await purchaseToken(james, purchaseAmount);
      const finalBalance = await getTokenBalanceOf(james);
      const expected = startingBalance.add(purchaseAmount);
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should transfer 10 tokens to Miguel.', async () => {
      const startingBalance = await getTokenBalanceOf(miguel);
      const purchaseAmount = new BN('10', 10);
      await purchaseToken(miguel, purchaseAmount);
      const finalBalance = await getTokenBalanceOf(miguel);
      const expected = startingBalance.add(purchaseAmount);
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should transfer 100 tokens to Edwhale.', async () => {
      const startingBalance = await getTokenBalanceOf(edwhale);
      const purchaseAmount = new BN('100', 10);
      await purchaseToken(edwhale, purchaseAmount);
      const finalBalance = await getTokenBalanceOf(edwhale);
      const expected = startingBalance.add(purchaseAmount);
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
  });

  describe('Emergency stop', () => {
    const purchaseInStopError = ' was able to purchase during the emergency stop';
    const balanceError = 'A balance was not as expected following a purchase';
    before(async () => {
      const sale = await Sale.deployed();
      await as(owner, sale.emergencyToggle);
    });
    it('should not transfer 1 token to James.', async () => {
      const startingBalance = await getTokenBalanceOf(james);
      const purchaseAmount = new BN('1', 10);
      try {
        await purchaseToken(james, purchaseAmount);
        const errMsg = james + purchaseInStopError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(james);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should not transfer 10 tokens to Miguel.', async () => {
      const startingBalance = await getTokenBalanceOf(miguel);
      const purchaseAmount = new BN('10', 10);
      try {
        await purchaseToken(miguel, purchaseAmount);
        const errMsg = miguel + purchaseInStopError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(miguel);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should not transfer 100 tokens to Edwhale.', async () => {
      const startingBalance = await getTokenBalanceOf(edwhale);
      const purchaseAmount = new BN('100', 10);
      try {
        await purchaseToken(edwhale, purchaseAmount);
        const errMsg = edwhale + purchaseInStopError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(edwhale);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    after(async () => {
      const sale = await Sale.deployed();
      await as(owner, sale.emergencyToggle);
    });
  });

  describe('Sale period 1', () => {
    const balanceError = 'A balance was not as expected following a purchase';

    it('should reject a transfer of tokens to Edwhale greater than the sum ' +
       'of tokens available for purchase.', async () => {
      const startingBalance = await getTokenBalanceOf(edwhale);
      const saleBalance = await getTokenBalanceOf(Sale.address);
      const tooMuch = saleBalance.add(new BN('1', 10));
      try {
        await purchaseToken(edwhale, tooMuch);
        const errMsg = `${edwhale} was able to purchase more tokens than should ` +
          'be available';
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(edwhale);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(
        finalBalance.toString(10), expected.toString(10), errMsg,
      );
    });
    it('should return excess Wei to Edwhale', async () => {
      const startingBalance = await ethQuery.getBalance(edwhale);
      const gasPrice = await ethQuery.gasPrice();
      const sale = await Sale.deployed();
      const excessEther = saleConf.price.div(new BN('2', 10));
      const receipt =
        await sale.purchaseTokens({
          value: saleConf.price.add(excessEther),
          from: edwhale,
          gasPrice,
        });
      const gasUsed = new BN(receipt.receipt.gasUsed, 10);
      const expectedEthDebit = gasPrice.mul(gasUsed).add(saleConf.price);
      const finalBalance = await ethQuery.getBalance(edwhale);
      const expected = startingBalance.sub(expectedEthDebit);
      const errMsg = 'Edwhale\'s ether balance is not as expected following ' +
        'a purchase transaction';
      assert.strictEqual(
        finalBalance.toString(10), expected.toString(10), errMsg,
      );
    });
    it('should transfer all the remaining tokens to Edwhale.', async () => {
      const startingBalance = await getTokenBalanceOf(edwhale);
      const saleBalance = await getTokenBalanceOf(Sale.address);
      await purchaseToken(edwhale, saleBalance);
      const finalBalance = await getTokenBalanceOf(edwhale);
      const expected = startingBalance.add(saleBalance);
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
  });

  describe('Post-sale period', () => {
    const balanceError = 'A balance was not as expected following a purchase';
    const sellOutError = ' was able to purchase when the sale was sold out';
    it('should not transfer 1 token to James.', async () => {
      const startingBalance = await getTokenBalanceOf(james);
      const purchaseAmount = new BN('1', 10);
      try {
        await purchaseToken(james, purchaseAmount);
        const errMsg = james + sellOutError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(james);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should not transfer 10 tokens to Miguel.', async () => {
      const startingBalance = await getTokenBalanceOf(miguel);
      const purchaseAmount = new BN('10', 10);
      try {
        await purchaseToken(miguel, purchaseAmount);
        const errMsg = miguel + sellOutError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(miguel);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should not transfer 100 tokens to Edwhale.', async () => {
      const startingBalance = await getTokenBalanceOf(edwhale);
      const purchaseAmount = new BN('100', 10);
      try {
        await purchaseToken(edwhale, purchaseAmount);
        const errMsg = edwhale + sellOutError;
        assert(false, errMsg);
      } catch (err) {
        const errMsg = err.toString();
        assert(isEVMException(err), errMsg);
      }
      const finalBalance = await getTokenBalanceOf(edwhale);
      const expected = startingBalance;
      const errMsg = balanceError;
      assert.strictEqual(finalBalance.toString(10), expected.toString(10), errMsg);
    });
    it('should report the proper sum of Wei in the wallet.', async () => {
      const balance = await ethQuery.getBalance(saleConf.wallet);
      const expected = tokensForSale.mul(saleConf.price);
      const errMsg = 'The amount of Ether in the wallet is not what it should be at sale end';
      assert.strictEqual(balance.toString(10), expected.toString(10), errMsg);
    });
    it('should report a zero balance for the sale contract.', async () => {
      const balance = await getTokenBalanceOf(Sale.address);
      const expected = new BN('0', 10);
      const errMsg = 'The sale contract still has tokens in it when it should be sold out';
      assert.strictEqual(balance.toString(10), expected.toString(10), errMsg);
    });
    it('should allow Edwhale to transfer 10 tokens to James.', async () => {
      const transferAmount = new BN('10', 10);
      const edwhaleStartingBalance = await getTokenBalanceOf(edwhale);
      const jamesStartingBalance = await getTokenBalanceOf(james);
      const sale = await Sale.deployed();
      const tokenAddr = await sale.token.call();
      const token = HumanStandardToken.at(tokenAddr);
      await as(edwhale, token.transfer, james, transferAmount);
      const edwhaleFinalBalance = await getTokenBalanceOf(edwhale);
      const edwhaleExpected = edwhaleStartingBalance.sub(transferAmount);
      const errMsg = balanceError;
      assert.strictEqual(
        edwhaleFinalBalance.toString(10), edwhaleExpected.toString(10), errMsg,
      );
      const jamesFinalBalance = await getTokenBalanceOf(james);
      const jamesExpected = jamesStartingBalance.add(transferAmount);
      assert.strictEqual(
        jamesFinalBalance.toString(10), jamesExpected.toString(10), errMsg,
      );
    });
  });

  describe('Filters and disbursers', () => {
    const earlyAccessFailure = 'Founder was able to withdraw from a filter ' +
      'earlier than should have been possible';
    const doubleAccessFailure = 'Founder was able to withdraw from a filter ' +
      'they had already withdrawn from';
    const balanceFailure = 'The founder\'s balance was not as expected after ' +
      'interacting with a filter';

    function signerAccessFailureFor(address) {
      return `WARNING: could not unlock account ${address}.\n` +
             'This is probably because this founder\'s private key is not generated \n' +
             'by the same mnemonic as your owner privKey. This is probably fine, but \n' +
             'it means we can\'t run this test.';
    }

    it('Should not allow founders to withdraw tokens before the vesting date', async () =>
      Promise.all(getFoundersAddresses().map(async (founder) => {
        let signerAccessFailure = false;
        const firstFilter = await getFilter(0);
        const secondFilter = await getFilter(1);
        try {
          await firstFilter.claim({ from: founder });
          assert(false, earlyAccessFailure);
        } catch (err) {
          if (isSignerAccessFailure(err)) {
            signerAccessFailure = true;
            console.log(signerAccessFailureFor(founder));
          } else {
            const errMsg = err.toString();
            assert(isEVMException(err), errMsg);
          }
        }
        if (!signerAccessFailure) {
          try {
            await secondFilter.claim({ from: founder });
            assert(false, earlyAccessFailure);
          } catch (err) {
            const errMsg = err.toString();
            assert(isEVMException(err), errMsg);
          }

          const founderBalance = await getTokenBalanceOf(founder);
          const expectedBalance = new BN('0', 10);
          assert.equal(expectedBalance.toString(10), founderBalance.toString(10),
            balanceFailure);
        }
      })),
    );
    it('Should allow founders to withdraw from the first tranch after that ' +
       'vesting date', () =>
      new Promise((resolve) => {
        ethRPC.sendAsync({
          method: 'evm_increaseTime',
          params: [34190000], // 13 months in seconds
        }, async (rpcErr) => {
          if (rpcErr) { throw rpcErr; }
          await Promise.all(
            getFounders().map(async (curr) => {
              let signerAccessFailure = false;
              const founder = foundersConf.founders[curr].address;
              const firstFilter = await getFilter(0);
              try {
                await firstFilter.claim({ from: founder });
              } catch (err) {
                if (isSignerAccessFailure(err)) {
                  signerAccessFailure = true;
                  console.log(signerAccessFailureFor(founder));
                } else {
                  throw err;
                }
              }
              if (!signerAccessFailure) {
                const foundersBalance = await getTokenBalanceOf(founder);
                const expectedBalance = new BN(foundersConf.founders[curr].amount, 10)
                  .div(new BN('2', 10));
                assert.equal(foundersBalance.toString(10),
                  expectedBalance.toString(10),
                  balanceFailure);
                const secondFilter = await getFilter(1);
                try {
                  await secondFilter.claim({ from: founder });
                  assert(false, earlyAccessFailure);
                } catch (err) {
                  const errMsg = err.toString();
                  assert(isEVMException(err), errMsg);
                }
              }
            }),
          );
          resolve();
        });
      }),
    );
    it('Should allow founders to withdraw from the second tranch after that ' +
       'vesting date', () =>
      new Promise((resolve) => {
        ethRPC.sendAsync({
          method: 'evm_increaseTime',
          params: [18410000], // 7 months in seconds
        }, async (rpcErr) => {
          if (rpcErr) { throw rpcErr; }
          await Promise.all(
            getFounders().map(async (curr) => {
              let signerAccessFailure = false;
              const founder = foundersConf.founders[curr].address;
              const firstFilter = await getFilter(0);
              try {
                await firstFilter.claim({ from: founder });
                assert(false, doubleAccessFailure);
              } catch (err) {
                if (isSignerAccessFailure(err)) {
                  signerAccessFailure = true;
                  console.log(signerAccessFailureFor(founder));
                } else {
                  const errMsg = err.toString();
                  assert(isEVMException(err), errMsg);
                }
              }
              if (!signerAccessFailure) {
                const secondFilter = await getFilter(1);
                await secondFilter.claim({ from: founder });
                const foundersBalance = await getTokenBalanceOf(founder);
                const expectedBalance = foundersConf.founders[curr].amount;
                assert.equal(foundersBalance.toString(10),
                  expectedBalance.toString(10),
                  balanceFailure);
              }
            }),
          );
          resolve();
        });
      }),
    );
  });
});
