const SHA256 = require('crypto-js/sha256');
const TARGET_DIFFICULTY = BigInt(0x00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
const MAX_TRANSACTIONS = 10;

class MemPool {
    constructor() {
        // TODO: instatiate a local redis instance to store transactions, subscribe to a websocket
        //       that will be filled by clients requesting transactions
        // for now just make an empty list
        this.transactionPool = [];
    }

    addTransaction(transaction) {
        // TODO: add transaction to mempool by pushing it to redis instance
        this.transactionPool.push(transaction);
    }

    removeTransaction() {
        if (this.transactionPool) {
            // TODO: remove transaction from mempool by pulling it from redis instance
            return this.transactionPool.pop();
        }

        return null;
    }
}

class Block {
    constructor() {
        this.timestamp = Date.now();
        this.nonce = 0;
        this.transactions = [];
    }

    addTransaction(tx) {
        if (this.transaction.length < MAX_TRANSACTIONS) {
            this.transactions.push(tx);
        }
    }

    hash() {
        return SHA256(
            this.timestamp + "" +
            this.nonce + "" +
            JSON.stringify(this.transactions)
        ).toString();
    }

    execute() {
        // TODO: add-on, may implement if I get far enough to warrant U/TXOs
        // something lke: this.transactions.forEach(x => x.execute()); assuming what gets pushed
        // to transactions is a transaction object
    }
}

class Chain {
    constructor() {
        this.blocks = this.getCurrentChain();
    }

    getCurrentChain() {
        // TODO: this method will request the current chain from other existing blockchain miners
        //       by sending out a request via a websocket - for the time being this method will
        //       just return an empty list
        return [];
    }

    addBlock(block) {
        this.blocks.push(block);
        // TODO: need to publish the creation of a new block over the websocket so that the other
        //       miners are aware of a new block on the chain
    }

    blockHeight() {
        return this.blocks.length;
    }
}

class Miner {
    constructor(address) {
        // address is the pubkey (aka address) of the miner
        this.address = address;
        this.blockToMine = null; // this where the new block to be mined will be stored
        this.blockChain = new Chain(); // instantiate the blockchain for this miner
        this.mempool = new MemPool(); // instatiate the mempool for this miner
    }

    startMining() {
        // Attempt to mine for blocks while simultaneously checking for any new blocks that may
        // have been mined somewhere else via the websocket and checking to see if any new
        // transactions have been requested

        while(true) {
            // Infinite mining!
            this.blockToMine = new Block();

            // TODO: need to also subscribe to the client websocket to make sure any new transactions
            //       requested by a client get added to the mempool
            for (let i = 0; i < MAX_TRANSACTIONS; i++) {
                let transaction = this.mempool.removeTransaction();

                if (transaction) {
                    this.blockToMine.addTransaction(transaction);
                }
                else {
                    break;
                }
            }

            // TODO: if at _any_ point during this inner loop a new transaction appears, need to
            //       put all the transactions back in to the mempool and start the inner loop
            //       again so the new transaction will get added to the block

            let newBlockHash = this.blockToMine.hash();
            while (BigInt`0x${newBlockHash}` > TARGET_DIFFICULTY) {
                this.blockToMine.nonce += 1;
                newBlockHash = this.blockToMine.hash();
            }

            this.blockToMine.blockHash = newBlockHash;
            this.blockChain.addBlock(this.blockToMine);
            // TODO: publish new block to the miner websocket to inform the other miners that they
            //       need to include the new block in their respective blockchains
        }
    }

    stopMining() {
        // TODO: save blockchain state to JSON file to pick back up from where the miner left off
    }
}

// TODO: make a 'main' so that if a miner wanted to start mining they could call node BlockChainMiner
//       which would instantiate the Miner class and start the miner
//       Could then listen for CTRL-C in an infinite loop which would then call stopMining

module.exports = {
    TARGET_DIFFICULTY,
    MAX_TRANSACTIONS,
    MemPool,
    Block,
    Chain,
    Miner,
};