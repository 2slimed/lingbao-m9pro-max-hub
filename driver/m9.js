import { COMMAND, PROFILE } from "./constants.js";
import { M9Profile } from "./profile.js";
import { M9Transport } from "./transport.js";
import { buildMacroBlob, macroBinding } from "./macro.js";
export class LingbaoM9 {
    transport;
    definition;
    constructor(transport, definition) {
        this.transport = transport;
        this.definition = definition;
    }
    static async connect(definition) {
        const device = await M9Transport.request();
        return new LingbaoM9(new M9Transport(device, M9Transport.detectLayout(device)), definition);
    }
    async readAllProfiles() {
        return this.transport.readBlock(COMMAND.profileMemory, this.definition.profileSize * this.definition.profileCount);
    }
    async readProfile(index = 0) {
        if (index < 0 || index >= this.definition.profileCount)
            throw new RangeError("Invalid profile index");
        const all = await this.readAllProfiles();
        const start = index * this.definition.profileSize;
        return new M9Profile(all.slice(start, start + this.definition.profileSize), this.definition);
    }
    async writeProfile(index, profile) {
        if (profile.bytes.length !== this.definition.profileSize)
            throw new Error("Profile size mismatch");
        const reply = await this.transport.transaction(() => this.transport.writeBlock(COMMAND.writeProfile, profile.bytes, index, this.definition.profileSize));
        return new M9Profile(reply.length >= this.definition.profileSize ? reply.slice(0, this.definition.profileSize) : profile.bytes.slice(), this.definition);
    }
    async mutateProfile(index, fn) {
        const p = await this.readProfile(index);
        fn(p);
        return this.writeProfile(index, p);
    }
    setPollingRate(index, kind, option) { return this.mutateProfile(index, p => p.setPollingRate(kind, option)); }
    setPollingRaw(index, kind, raw) { return this.mutateProfile(index, p => p.setPollingRaw(kind, raw)); }
    setLiftOffDistance(index, option) { return this.mutateProfile(index, p => p.setLiftOffDistance(option)); }
    setLiftOffDistanceRaw(index, raw) { return this.mutateProfile(index, p => { p.liftOffDistanceRaw = raw; }); }
    setMotionSync(index, enabled) { return this.mutateProfile(index, p => p.setMotionSync(enabled)); }
    setLinearCalibration(index, enabled) { return this.mutateProfile(index, p => p.setLinearCalibration(enabled)); }
    setDebounce(index, ms) { return this.mutateProfile(index, p => p.setDebounce(ms)); }
    setSleepSeconds(index, seconds) { return this.mutateProfile(index, p => p.setSleepSeconds(seconds)); }
    async readDefaultKeyMatrix() {
        return this.transport.readBlock(COMMAND.defaultKeyMatrix, this.definition.matrixSize);
    }
    async readKeyMatrix(index = 0) {
        const all = await this.transport.readBlock(COMMAND.basicDeviceInfo, this.definition.matrixSize * this.definition.profileCount);
        const start = index * this.definition.matrixSize;
        return all.slice(start, start + this.definition.matrixSize);
    }
    async writeKeyMatrix(matrix) {
        if (matrix.length !== this.definition.matrixSize)
            throw new Error("Key matrix size mismatch");
        return this.transport.writeMatrix(matrix, 0, this.definition.matrixSize);
    }
    async writeMacroImage(blob) {
        if (!(blob instanceof Uint8Array)) blob = Uint8Array.from(blob);
        // Captured official macro creation: 0x01 -> 0x15 windows -> 0x02.
        // Unlike ordinary matrix edits there is no observed 0x1A prepare command.
        await this.transport.transaction(() => this.transport.sendMacroBlob(blob));
        return blob;
    }
    async uploadMacro(existing, events) {
        const blob = buildMacroBlob(existing, events);
        const index = blob.macroIndex;
        await this.writeMacroImage(blob);
        return { index, blob };
    }
    macroBinding(index, playback) {
        return Uint8Array.from(macroBinding(index, playback));
    }
    static profileOffsets = PROFILE;
}
