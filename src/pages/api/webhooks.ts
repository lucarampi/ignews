import { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import Stripe from "stripe";
import { stripe } from "../../services/stripe";
import { saveSubscription } from "./_lib/manegeSubscription";

//handle streaming
async function buffer(readable: Readable) {
    const chunks = []

    for await (const chunk of readable) {
        chunks.push(
            typeof chunk === "string" ? Buffer.from(chunk) : chunk
        )
        return Buffer.concat(chunks);
    }
}

export const config = {
    api: {
        //Disable bodyParser to consume it as a Stream
        bodyParser: false,
    },
}

const relevantEvents = new Set([
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
])

export default async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method == 'POST') {
        const buf = await buffer(req);
        const secret = req.headers['stripe-signature']
        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(buf, secret, process.env.STRIPE_WEBHOOK_SECRET);
            console.log(event.type);
        } catch (err) {
            res.status(400).send(`Webhook error: ${err.message}`);
        }

        const { type } = event;

        if (relevantEvents.has(type)) {
            try {
                switch (type) {

                    case 'customer.subscription.updated':
                    case 'customer.subscription.deleted':
                        const subscription = event.data.object as Stripe.Subscription;
                        console.log(type)
                        await saveSubscription(
                            subscription.id.toString(),
                            subscription.customer.toString(),
                            false,
                        )

                        break;


                    case 'checkout.session.completed':

                        const checkoutSession = event.data.object as Stripe.Checkout.Session;
                        await saveSubscription(
                            checkoutSession.subscription.toString(),
                            checkoutSession.customer.toString(),
                            true
                        );
                        break;
                    default:
                        console.log('ERROR TYPE');
                        throw new Error('Unhandled event.');
                }
            }
            catch (err) {
                console.log('ALREADY REGISTERED!')
                console.log(err)
                return res.status(400).json({ error: 'Webhook handler failed.' })
            }
        }

        // console.log('evento recebido', event)
        return res.status(200).json({ received: true });
    } else {
        console.log('Method not allowed')
        res.setHeader('Allow', 'POST');
        res.status(405).end('Method not allowed')
    }
}