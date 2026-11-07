# Mesh Feasibility for the Hackathon

**Status:** Research record; the accepted local-peer implementation is now verified. See [MESH-IMPLEMENTATION.md](MESH-IMPLEMENTATION.md) for measured proof. Native phone/radio feasibility remains unverified.\
**Research date:** November 6, 2026; updated November 7, 2026.\
**Build window:** Saturday, November 7, 2026 at 10:00 AM through Sunday, November 8, 2026 at 10:00 AM, America/Chicago.\
**Confirmed inventory ceiling:** this Mac and possibly one iPhone running iOS 27.0.1. No third device is available.

## Decision

The confirmed hardware cannot prove a three-device physical mesh. With only the Mac, the team can build and adversarially test the real mesh protocol across three isolated local processes. With the Mac and iPhone, it may additionally prove one native physical Apple peer-to-peer link after a signing/run smoke test. Neither result proves physical relay or native-radio multihop.

**Accepted scope, November 7, 2026:** preserve both mandatory pillars by implementing forwarding, persistence, identity, encryption, replay protection, and signed recipient receipts across three real local peer processes from hour zero, including relay restart recovery. Add the Mac↔iPhone link only if setup works. Physical three-device/radio mesh remains explicitly unverified. This supersedes the original physical demo criterion; no additional confirmation or third-device request is needed.

This is a feasibility recommendation, not a guarantee that peer-to-peer Wi-Fi, signing, permissions, or background behavior will work on uninspected hardware. Apple explicitly recommends real-device testing for local-network privacy, and API availability does not prove the target hardware and OS combination.

## What each possible demonstration proves

| Setup | What it can honestly prove | What it cannot prove |
| --- | --- | --- |
| Three isolated processes on the Mac | The real protocol's deterministic routing, persistence, deduplication, signatures, E2E encryption, receipts, partitions, restart recovery, and B-mediated forwarding | Physical peer discovery, separate hardware failure boundaries, native radio relay, or physical mesh |
| Mac plus iPhone | One real native link, discovery, permissions, bidirectional transfer, reconnect, and possibly Apple peer-to-peer Wi-Fi without an access point | Relay, multihop, or mesh; there is no distinct B between A and C |
| Three devices on one LAN or hotspot | Real-device application relay A→B→C and store-and-forward behavior if the direct A↔C application path is independently blocked | Infrastructure-independent radio mesh or physical range extension; the router/hotspot remains infrastructure |
| Three Apple devices using peer-to-peer Wi-Fi | Native nearby links without configuring a Wi-Fi network, plus application relay if the app implements it | Automatic multihop. Network.framework supplies links; the product must implement forwarding, persistence, loop prevention, receipts, and topology evidence |
| Three physical devices with A↔C physically/link-layer unreachable, A↔B and B↔C reachable | A genuine multihop/range-extension proof if A→B→C and C→B→A are observed | Broad claims about arbitrary hardware, background reliability, or a production mesh |

One Mac cannot become three physical mesh nodes by running three processes, containers, or simulators. Those are useful deterministic tests, but all nodes share a host, radio, OS account, and failure boundary. A simulator also does not substitute for real-device local-network privacy testing; Apple says to test that behavior on a real device in [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

## How the iPhone participates

The iPhone needs a native iOS app built from the same small peer target as the Mac app. The app advertises a fixed Bonjour service with a Network.framework listener, browses for that same service, opts its Network parameters into peer-to-peer interfaces, and opens a connection to a selected enrolled peer. Apple documents `NWListener` as the listener and Bonjour advertiser, `NWBrowser` as the service browser, and `NWConnection` as the bidirectional connection in the [Network framework documentation](https://developer.apple.com/documentation/network/nwlistener). Apple says to set `includePeerToPeer` on the parameters used by connections and listeners to opt into Apple peer-to-peer Wi-Fi in [TN3151](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api).

The iPhone build must include `NSLocalNetworkUsageDescription` and the specific service type in `NSBonjourServices`. Bonjour registration, browsing, and resolution all require Local Network access. The user must grant the prompt while the app is foregrounded; an undetermined permission request attempted from the background is denied without showing the prompt. These rules and failure states are documented in [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy) and the [`NSLocalNetworkUsageDescription` reference](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSLocalNetworkUsageDescription).

A browser page is not the iPhone peer for this design. Safari-hosted JavaScript does not expose Network.framework's listener, peer-to-peer parameter, or Bonjour advertisement/browser objects. A browser UI may talk to an already reachable HTTP service, but it cannot originate this native peer discovery and listening path. Treat any browser-through-Mac arrangement as a client of a relay, not as a native radio peer.

Keep the iPhone app in the foreground during the demo. iOS normally suspends apps after they move to the background and supports only limited declared background modes; an ordinary mesh listener is not a general permission for indefinite background execution. Apple documents that limitation in [Configuring background execution modes](https://developer.apple.com/documentation/Xcode/configuring-background-execution-modes) and [Preparing your UI to run in the background](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background). Do not promise always-on background relay.

## Apple transport choice

Use the established `NWListener` / `NWBrowser` / `NWConnection` Network.framework APIs for the first spike, with a single declared Bonjour service type and `includePeerToPeer = true`. The newer Swift Network APIs described in Apple's 2026 material target iOS 26 and aligned releases, while the candidate Xcode 16.4 bundles an iOS 18.5 SDK. Choosing the established API surface avoids requiring iOS 27 SDK APIs and preserves the possibility of building with Xcode 16.4 on the current Mac.

Apple peer-to-peer Wi-Fi works only between Apple devices because its wire protocol is not documented for third-party use. Apple states this directly in [TN3151](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api). A heterogeneous third device therefore does not complete this transport topology.

Multipeer Connectivity is not the recommended new implementation. It can discover and communicate with nearby devices and historically uses infrastructure Wi-Fi, peer-to-peer Wi-Fi, and Bluetooth PAN on iOS, as described in Apple's [Multipeer Connectivity documentation](https://developer.apple.com/documentation/multipeerconnectivity). However, Apple deprecated it in 2026 and directs new work to Network.framework in [TN3151](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api) and [TN3213](https://developer.apple.com/documentation/technotes/tn3213-moving-from-multipeer-connectivity-to-network-framework). It should only be reconsidered if a pre-existing, already-tested codebase materially lowers delivery risk and the deprecation is disclosed.

Do not request the multicast entitlement for the fixed-service Bonjour design unless testing proves that the chosen operations require it. Apple distinguishes ordinary declared Bonjour use from direct multicast/broadcast and arbitrary-service browsing; direct multicast/broadcast on iOS requires `com.apple.developer.networking.multicast`. See [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

## Packaging and current Mac readiness

Read-only inspection found:

- macOS 15.5 (build 24F74), Apple silicon target;
- Apple Swift 6.1.2 in `/Library/Developer/CommandLineTools`;
- no full Xcode selected or installed through the active developer path; `xcodebuild` is unavailable.

The command-line Swift toolchain can support the three-process macOS protocol proof, but it is not enough for the normal iPhone build, pairing, signing, provisioning, and installation workflow. Full Xcode is a prerequisite for the optional iPhone link, not for the core local protocol proof.

The iPhone is confirmed on iOS 27.0.1, but that fact alone does **not** establish that this Mac must upgrade to macOS 26.6 or use Xcode 27. Apple's [SDK and system requirements table](https://developer.apple.com/xcode/system-requirements/) separates host compatibility, bundled SDK, deployment targets, and device support:

- Xcode 27 requires macOS 26.6 or later, so it cannot run on this Mac's current macOS 15.5.
- Xcode 27 bundles the iOS 27 SDK. Xcode 16.4 bundles the iOS 18.5 SDK.
- An SDK determines which APIs the app can compile against; it is not the same as the OS runtime installed on a connected phone.
- Device support describes the OS versions on which Xcode can debug a physical device.

The same table lists Xcode 16.4 as supported on macOS 15.3 through macOS 26.1.x and lists device support as “iOS 15 or later.” Apple's [Xcode 16.4 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-16_4-release-notes) repeat that it supports on-device debugging on iOS 15 and later despite bundling the iOS 18.5 SDK. This makes Xcode 16.4 the least disruptive candidate to test on the current Mac. It does not prove that signing, installation, launching, debugging, or Network.framework behavior will work with this specific iOS 27.0.1 phone. Conversely, Xcode 16.4 cannot compile against iOS 27-only APIs even if it can run an app built with older APIs on that phone. Apple's [Xcode 27 release notes](https://developer.apple.com/documentation/Xcode-Release-Notes/Xcode-27-release-notes) describe iOS 27 device pairing changes but do not establish that every older Xcode/device combination fails.

Do not make a macOS/Xcode 27 upgrade part of the 24-hour critical path. No installation or system change is authorized by this research. If the optional physical spike is approved, first perform a reversible Xcode 16.4 signing/run smoke test. If it fails, record the exact failure and continue with the local protocol proof rather than beginning an operating-system upgrade during the build window.

For a physical iPhone, Apple's documented path is:

1. Install and open compatible Xcode and its required iOS platform support.
2. Connect the iPhone, trust the Mac, and select it as the run destination.
3. Sign in to an Apple Account in Xcode, assign the app to a Team, and leave automatic signing enabled so Xcode registers the device and creates the development profile.
4. Initiate pairing, enable Developer Mode in Settings > Privacy & Security, restart the iPhone, confirm Developer Mode, and enter the device passcode.
5. Build and run from Xcode, then grant the app's Local Network permission in the foreground.

Apple documents physical-device signing and automatic provisioning in [Running your app on simulated or physical devices](https://developer.apple.com/documentation/Xcode/running-your-app-on-simulated-or-physical-devices), and Developer Mode in [Enabling Developer Mode on a device](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/). A free Personal Team may suffice for basic on-device testing; validate its current restrictions and needed capabilities using [Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/). The account agreement state, cable, trust state, free storage, exact Xcode compatibility, and capability availability remain unverified.

Before committing to native iPhone integration, prove that Xcode recognizes the phone, automatic signing succeeds, a trivial signed app launches, Developer Mode is enabled, and Local Network permission can be granted. Protocol schemas, deterministic routing tests, and the three-process proof can progress independently; they do not satisfy a physical-link proof. No OS/tool installation or security-setting change was performed during this audit.

## Minimum 24-hour build recommendation

Use the mesh protocol as a narrow communications proof beside the cyber response loop, with a dedicated work slot from hour zero.

1. **Hour-zero contract:** assign A, B, and C distinct process identities, keys, storage directories, ports, and allowlisted peer graphs. Prevent A↔C in application configuration and independently verify that connection attempts fail.
2. **Three-process protocol slice:** implement a bounded persistent queue, message ID, hop limit, seen-ID set, A→B→C forwarding, and C→B→A recipient acknowledgment. Use the same envelope and forwarding code intended for a future physical transport. Keep payloads fictional.
3. **Failure proof:** show B's stop preventing A→C delivery, B's restart preserving custody, queued delivery resuming, duplicates remaining idempotent, and forged or expired messages and acknowledgments being rejected.
4. **Optional physical spike:** only after an Xcode 16.4 signing/run gate succeeds, run the same envelope over Mac↔iPhone with both apps foregrounded and WAN unavailable. Prove discovery, transfer in each direction, disconnect, and reconnect. Record the observed path; do not infer peer-to-peer Wi-Fi merely from delivery success.
5. **Integrate minimally:** transport only incident coordination messages and verified fallback-task updates. Do not route approvals, infrastructure commands, roles, enrollment, or incident closure as ordinary offline messages.

The smallest acceptance evidence is a timestamped topology record, A's signed envelope, B's receive/persist/forward events, C's verified receipt, C's signed recipient acknowledgment, B's reverse-forward events, and A's verified acknowledgment. A hop acknowledgment from B is not evidence that C received the message.

## Ranked fallback choices

1. **Three isolated Mac processes plus optional Mac↔iPhone link:** recommended available scope. This proves the real mesh protocol and, if the optional gate passes, one physical native link. Label it as a protocol simulation plus a two-device transport proof, never as a three-device physical mesh.
2. **Three isolated Mac processes only:** reliable fallback requiring no system change. It proves routing, persistence, replay defenses, receipts, partitions, and recovery, but no physical link or physical mesh.
3. **Cyber response loop without the mesh protocol:** conflicts with the confirmed requirement that both pillars remain mandatory and should be considered only if the user explicitly changes scope again.

The user explicitly accepted the local protocol demonstration. Its evidence must still record the shared host/OS/radio boundary. The acceptance change does not turn local processes into physical devices or verify native-radio multihop.

## Security boundary for peers and relays

Transport security and end-to-end message security are separate controls. Even if each Network.framework connection uses TLS, relay B terminates two transport links and may read or alter plaintext unless the message itself is protected for C. Multipeer Connectivity's link/session encryption has the same relay limitation. The minimum envelope should bind protocol version, message ID, organization and incident scope, sender device identity, intended recipient identity, created time, expiry, payload digest/ciphertext, and hop policy under the sender's signature. Encrypt sensitive content for the final recipient independently of B.

For an all-Apple Swift spike whose devices run at least iOS 17 and macOS 14, prefer **CryptoKit HPKE plus CryptoKit Ed25519 signatures** over adding libsodium Swift/C bindings during a 24-hour build. CryptoKit is built into the target platforms, its `HPKE.Sender` and `HPKE.Recipient` perform the standardized hybrid public-key encryption operation, and `Curve25519.Signing.PrivateKey.signature(for:)` / `PublicKey.isValidSignature` provide Ed25519 signing and verification. Apple's official references are [`HPKE.Recipient`](https://developer.apple.com/documentation/CryptoKit/HPKE/Recipient), [`HPKE.Ciphersuite`](https://developer.apple.com/documentation/cryptokit/hpke/ciphersuite), [`Curve25519.Signing.PrivateKey`](https://developer.apple.com/documentation/cryptokit/curve25519/signing/privatekey), and [`isValidSignature`](https://developer.apple.com/documentation/cryptokit/curve25519/signing/publickey/isvalidsignature(_:for:)). The installed Apple macOS 15.5 SDK declares HPKE available on iOS 17+, macOS 14+, watchOS 10+, tvOS 17+, and Mac Catalyst 17+. The confirmed iOS 27.0.1 runtime clears that OS-version floor, but the full Xcode signing/run path remains unverified.

Use one HPKE sender/recipient context per independently queued message so delayed or reordered store-and-forward does not depend on a shared ordered stream. Carry that message's HPKE encapsulated key and fixed algorithm/version identifiers with its ciphertext, authenticate immutable envelope fields as HPKE associated data, and sign the complete canonical envelope separately for durable sender evidence. Use a fixed reviewed CryptoKit cipher suite supported by every inspected target; do not compose raw X25519, HKDF, and AEAD calls into a custom protocol. Keep signing and HPKE key-agreement keys separate.

If any required device is below iOS 17/macOS 14, do not improvise a replacement ECDH/HKDF design. Either use the existing security plan's maintained libsodium candidates—[authenticated encryption](https://doc.libsodium.org/public-key_cryptography/authenticated_encryption) and [Ed25519 signatures](https://doc.libsodium.org/public-key_cryptography/public-key_signatures)—after confirming its Apple bindings build early, or restrict the mesh spike to synthetic nonsensitive payloads and explicitly label it as transport/relay evidence without verified end-to-end confidentiality. For this deadline, CryptoKit on compatible Apple devices is the smallest honest secure-message choice.

A recipient acknowledgment must name and bind the original message ID, recipient, outcome, and time and must be authenticated by C. B can issue a distinct hop receipt for queue diagnostics, but cannot forge or substitute C's acknowledgment. Deduplicate by immutable message ID, reject expired envelopes and invalid scopes, bound hop count and payload size, rate-limit each enrolled peer, cap queues, persist before acknowledging custody, and retain failure/eviction evidence.

Discovery is not enrollment. A Bonjour result or working TLS session proves reachability, not organization membership or authority. Pin enrolled device public keys after an explicit out-of-band fingerprint/QR comparison. Relays must never turn offline messages into approvals, role changes, containment commands, or replayed privileged operations. Revocation cannot retract ciphertext already cached by a disconnected device; minimize cached data and state this limitation.

Attack tests for the demo should include a fake advertiser, unknown key, altered ciphertext, sender-signature failure, replayed message ID, forged recipient acknowledgment, expired message, oversized payload, queue exhaustion, relay restart, and B disappearance. A compromised endpoint can still disclose its own plaintext and keys; end-to-end encryption does not make a compromised recipient safe. A malicious relay can drop, delay, reorder, duplicate, or analyze metadata even when it cannot read or forge protected content.

## Precise go/no-go gate

Proceed with the proposed mesh-protocol slice only after the user explicitly accepts three isolated processes as the hackathon proof boundary. Its implementation gate is:

- A, B, and C have isolated identity, key, persistence, and network configuration;
- the real forwarding/envelope code runs unchanged across the three processes;
- direct A↔C application delivery is independently rejected;
- B is necessary for delivery and survives process restart without losing queued custody;
- recipient-authenticated acknowledgment returns C→B→A;
- logs and presentation language identify the proof as local process isolation, not physical mesh.

The optional iPhone branch has a separate gate: compatible full Xcode runs on this Mac, recognizes iOS 27.0.1, signs and launches a trivial app, Developer Mode is enabled, and Local Network permission and discovery work. If any item fails, stop that branch without an OS upgrade. Preserve the failure evidence, continue the protocol proof and cyber response loop, and make no physical-link claim.
