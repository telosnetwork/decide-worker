//env
require('dotenv').config();

//db
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('db.json');
const db = low(adapter);

//authority provider
const CosignAuthorityProvider = require('./CosignAuthorityProvider');

//eosjs
const { Api, JsonRpc, RpcError } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig'); //development only
const fetch = require('node-fetch'); //node only; not needed in browsers
const { TextEncoder, TextDecoder } = require('util'); //node only; native TextEncoder/Decoder
const defaultPrivateKey = process.env.WORKER_PRIV_KEY;
const signatureProvider = new JsSignatureProvider([defaultPrivateKey]);
const rpc = new JsonRpc(process.env.RPC_ENDPOINT, { fetch });
const api = new Api({ rpc, authorityProvider: new CosignAuthorityProvider(rpc), signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

//action hopper
const ActionHopper = require('./ActionHopper');
const hopper = new ActionHopper(process.env.WORKER_ACCT_NAME, api);

//hyperion
const HyperionSocketClient = require('@eosrio/hyperion-stream-client').default;
const client = new HyperionSocketClient(process.env.HYPERION_ENDPOINT, { async: false });

//define db
const dbSchema = {
    config: {
        worker_account: process.env.WORKER_ACCT_NAME,
        pub_key: process.env.WORKER_PUB_KEY
    },
    ballots: [],
    watchlist: []
};

//set db defaults
db.defaults(dbSchema)
    .write()

//define streams to watch
client.onConnect = () => {

    //openvoting action stream
    client.streamActions({
        contract: 'telos.decide',
        action: 'openvoting',
        account: '',
        start_from: 0,
        read_until: 0,
        filters: [],
    });

    //closevoting action stream
    // client.streamActions({
    //     contract: 'telos.decide',
    //     action: 'closevoting',
    //     account: '',
    //     start_from: 0,
    //     read_until: 0,
    //     filters: [],
    // });

    //castvote action stream
    client.streamActions({
        contract: 'telos.decide',
        action: 'castvote',
        account: '',
        start_from: 0,
        read_until: 0,
        filters: [],
    });

    //voters table delta stream
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

}

//handle stream data
client.onData = async (data) => {

    //if action stream
    if (data.type == 'action') {

        console.log('>>> Action Received:');

        //initialize
        const actionName = data.content.act.name;

        //perform task based on action name
        switch (actionName) {
            case 'openvoting':
                //TASK: add ballot to ballots list in db

                //validate
                //TODO: check ballot is VOTE

                //define new ballot
                const newBallot = {
                    ballot_name: data.content.act.data.ballot_name,
                    end_time: data.content.act.data.end_time
                };

                //write new ballot
                db.get('ballots')
                    .push(newBallot)
                    .write()

                break;
            case 'closevoting':
                //TASK: remove ballot from ballots list in db

                //validate
                //TODO: check ballot is VOTE

                //remove ballot from list
                db.get('ballots')
                    .remove({ ballot_name: data.content.act.ballot_name })
                    .write()

                break;
            case 'castvote':
                //TASK: add vote to watchlist if not exists

                //initialize
                const voter = data.content.act.data.voter;
                const ballot = data.content.act.data.ballot_name;

                //validate
                //TODO: check ballot is VOTE from db

                //check for existing voter on watchlist
                const res = db.get('watchlist')
                    .find({ account_name: voter })
                    .size()
                    .value()

                //if account found on watchlist
                if (res != 0) {

                    //check for existing vote
                    const res2 = db.get('watchlist')
                        .find({ account_name: voter })
                        .get('votes')
                        .find({ ballot_name: ballot })
                        .size()
                        .value()

                    //if vote not found
                    if (res2 == 0) {

                        //define new vote
                        const new_vote = {
                            ballot_name: ballot
                        };

                        //add vote to watchlist
                        db.get('watchlist')
                            .find({ account_name: voter })
                            .get('votes')
                            .push(new_vote)
                            .write()

                    } else { //if vote found

                        console.log('Vote Found. Skipping.');

                        //TODO: check ballot status. if ended, remove ballot.

                    }

                } else { //if account not found on watchlist

                    //define new voter
                    const new_voter = {
                        account_name: voter,
                        votes: [
                            {
                                ballot_name: ballot
                            }
                        ]
                    };

                    //write new voter to watchlist
                    db.get('watchlist')
                        .push(new_voter)
                        .write()

                }

                break;
            default:
                console.error('Action Not Found', actionName);
        }

    }

    //if delta stream
    if (data.type == 'delta') {

        console.log('>>> Table Delta Received: ');

        //initialize
        const voter = data.content.scope;
        let didFilter = false;
        let filteredVotes = [];

        //get config info
        const conf = db.get('config')
            .value()

        //get account's vote list
        const votesList = db.get('watchlist')
            .find({ account_name: voter })
            .get('votes')
            .value()

        //filter votes list
        votesList.forEach(element => {
            //get ballot
            const ballotQuery = db.get('ballots')
                .find({ ballot_name: element.ballot_name })
                .value()

            //if ballotQuery not undefined (in votes list but not ballots list)
            if (ballotQuery) {
                //if ballot still active
                if (Date.now() < Date.parse(ballotQuery.end_time)) {
                    //define vote
                    const newVote = {
                        ballot_name: element.ballot_name
                    };
                    //add to filtered votes
                    filteredVotes.push(newVote);
                } else {
                    didFilter = true;
                }
            } else { //ballot undefined
                //TODO: fetch ballot from chain and add to db
            }
        });

        //load action hopper
        filteredVotes.forEach(element => {
            //define rebal action
            let rebal_action = {
                account: 'telos.decide',
                name: 'rebalance',
                authorization: [
                    {
                        actor: conf.worker_account,
                        permission: 'active',
                    }
                ],
                data: {
                    voter: voter,
                    ballot_name: element.ballot_name,
                    worker: conf.worker_account
                }
            }
            //push action to hopper
            hopper.load(rebal_action);
        });

        //if votes were filtered from vote list
        if (didFilter) {
            //set filteredVotes as new votes
            db.get('watchlist')
                .find({ account_name: voter })
                .set('votes', filteredVotes)
                .write()
        }

        // const cosign_action = {
        //     account: 'energytester',
        //     name: 'cosign',
        //     authorization: [
        //         {
        //             actor: 'energytester',
        //             permission: 'active',
        //         }
        //     ],
        //     data: {
        //         account_owner: 'decideworker'
        //     }
        // };
        // hopper.frontload(cosign_action);
        // console.log('Cosigning...');
        // hopper.cosign();

        // hopper.view();

        //if hopper not empty
        if (filteredVotes.length > 0) {
            hopper.fire();
        }
        
    }

}

//connect to stream(s)
client.connect(() => {
    console.log('Worker Node ONLINE');
    console.log('Streaming from', process.env.CHAIN_NAME);
});