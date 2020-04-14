//env
require('dotenv').config()

//db
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db.json')
const db = low(adapter)

//eosjs
const { Api, JsonRpc, RpcError } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig'); //development only
const fetch = require('node-fetch'); //node only; not needed in browsers
const { TextEncoder, TextDecoder } = require('util'); //node only; native TextEncoder/Decoder
const defaultPrivateKey =  process.env.WORKER_PRIV_KEY || "5JtUScZK2XEp3g9gh7F8bwtPTRAkASmNrrftmx4AxDKD5K4zDnr";
const signatureProvider = new JsSignatureProvider([defaultPrivateKey]);
const rpc = new JsonRpc('https://testnet.telos.caleos.io', { fetch });
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

//hyperion
const HyperionSocketClient = require('@eosrio/hyperion-stream-client').default;
const client = new HyperionSocketClient('https://testnet.telosusa.io', {async: false});

const dbSchema = {
    config: {
        last_job_id: 1
    },
    worker: {
        account: process.env.WORKER_ACCT_NAME || 'decideworker',
        pub_key: process.env.WORKER_PUB_KEY || 'EOS5bbCLHnJ7jU1RWdFY7g5LoeCGCVRhtRjpZdKB9FxNx8xtoi3pA',
        status: 'Initializing'
    },
    watching: []
};

//set db defaults
db.defaults(dbSchema)
  .write()

client.onConnect = () => {

    //delta stream
    client.streamDeltas(
        {
            code: 'telos.decide',
            table: 'voters',
            scope: '*',
            payer: '',
            start_from: 0,
            read_until: 0,
        }
    );

    //action stream
    client.streamActions({
        contract: 'telos.decide',
        action: 'castvote',
        account: '',
        start_from: 0,
        read_until: 0,
        filters: [],
    });

}

client.onData = async (data) => {

    //if action stream
    if (data.type == 'action') {

        console.log('>>> Action Received:');
        // console.log(data.content.act.data);

        let voter = data.content.act.data.voter;
        let ballot = data.content.act.data.ballot_name;

        //find existing voter
        let res = db.get('watching')
            .find({ account_name: voter })
            .size()
            .value()

        // console.log('res: ', res)

        //voter found
        if (res != 0) {

            console.log('Voter Found. Finding Ballot...');

            //find existing ballot name
            let res2 = db.get('watching')
                .find({ account_name: voter })
                .get('active_ballots')
                .find({ ballot_name: ballot })
                .size()
                .value()

            console.log('res2: ', res2);

            //ballot found
            if (res2 != 0) {

                console.log('Ballot Found. Skipping.');

            } else { //ballot not found

                console.log('Ballot Not Found. Adding...');

                const new_bal_entry = {
                    ballot_name: ballot
                };
    
                db.get('watching')
                    .find({ account_name: voter })
                    .get('active_ballots')
                    .push(new_bal_entry)
                    .write()

                console.log('Ballot Added.');

            }

            //update existing entry
            // db.get('watching')
            //     .find({ account_name: voter })
            //     .get('active_ballots')
            //     .push({ ballot_name: ballot})
            //     .write()

        } else { //voter not found

            console.log('Voter Not Found. Adding...');

            const new_voter_entry = {
                account_name: voter,
                active_ballots: [
                    {
                        ballot_name: ballot
                    }    
                ]
            };

            db.get('watching')
                .push(new_voter_entry)
                .write()

            console.log('Voter Added.');
        
        }

    }

    //if delta stream
    if (data.type == 'delta') {

        console.log('>>> Delta Received:');
        console.log(data);

        

    }

}

client.connect(() => {
    console.log('Worker node connected');
});