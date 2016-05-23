'use strict';

const fs = require('fs');
const FIELD_TYPES = {
    C: 'Character',
    L: 'Boolean',
    D: 'Date',
    N: 'Numeric'
};

const FIELD_SIZES = {
    C: 254,
    L: 1,
    D: 8,
    N: 18
};

const FIELD_OFFSET_SIZE = 32;
const FIELD_DELIMITER = 0x0D;
const RECORD_DELETED = 0x2A; // asterisk

function zeroFill(value, desiredLength, direction = 'left') {
    const zeroes = '0'.repeat(desiredLength - value.length);
    switch (direction) {
    case 'left':
        return zeroes + value;
    case 'right':
        return value + zeroes;
    default:
        return value;
    }
}

function decodeHeader(buff) {
    return {
        bytesInHeader: buff.readUInt16LE(8),
        bytesPerRecord: buff.readUInt16LE(10),
        lastUpdated: decodeHeaderDate(buff),
        totalRecords: buff.readUInt32LE(4)
    };
}

function decodeHeaderDate(buff) {
    let date = new Date();
    // NOTE: buff byte 1 is the year in range 1900-2155.
    // However it's in format 1900 + N,
    // where N is the year in the buffer.
    date.setUTCFullYear(1900 + buff[1]);
    date.setUTCMonth(buff[2]);
    date.setUTCDate(buff[3]);
    return date.toUTCString();
}

function decodeField(buff, fieldOffset) {
    let fieldBuff = buff.slice(fieldOffset, fieldOffset + FIELD_OFFSET_SIZE);
    return {
        // NOTE: Field names are zero-filled ASCII-encoded 11 bytes long strings.
        // Remove the zero-filled characters in the string.
        name: fieldBuff.toString('ascii', 0, 11).replace(/\u0000/g, ''),
        type: FIELD_TYPES[fieldBuff.toString('ascii', 11, 12)],
        length: fieldBuff[16]
    };
}

function decodeFields(buff) {
    let fields = [];
    let fieldOffset = FIELD_OFFSET_SIZE;

    while (buff[fieldOffset] != FIELD_DELIMITER) {
        fields.push(decodeField(buff, fieldOffset));
        fieldOffset += FIELD_OFFSET_SIZE;
    }
    return fields;
}

function decodeRecords(buff, fields, header) {
    let records = [];
    for (let i = 0; i < header.totalRecords; i++) {
        let recordOffset = header.bytesInHeader + (i * header.bytesPerRecord);
        let record = {
            _isDel: buff[recordOffset] == RECORD_DELETED
        };
        recordOffset++;

        for (let j = 0; j < fields.length; j++) {
            let field = fields[j];
            const Type = field.type == 'Numeric' ? Number : String;
            record[field.name] = Type(buff.toString('ascii',
                                                    recordOffset,
                                                    recordOffset + field.length
                                                   ).trim()
                                     );
            recordOffset += field.length;
        }

        records.push(record);
    }

    return records;
}

fs.readFile('./world.dbf', (err, buff) => {
    // Decode
    const header = decodeHeader(buff);
    console.log(header);
    const fields = decodeFields(buff);
    let records = decodeRecords(buff, fields, header);

    console.log('Start encoding!');

    // Encode back
    let headerBuffer = new Buffer(32);
    // Write version DBase 5.0
    headerBuffer.writeUInt8(0x05, 0);
    const dateNow = new Date();
    headerBuffer.writeUInt8(dateNow.getYear(), 1);
    headerBuffer.writeUInt8(dateNow.getMonth(), 2);
    headerBuffer.writeUInt8(dateNow.getDate(), 3);
    // TODO: actually add number of records
    headerBuffer.writeUInt32LE(records.length, 4);
    // TODO: explain the header size for DBase 5.0.
    let headerSize = 33 + (fields.length * 32);
    headerBuffer.writeUInt16LE(headerSize, 8);

    let writeFieldOffset = FIELD_OFFSET_SIZE;

    let fileBuffer = Buffer.concat([headerBuffer], headerBuffer.length);

    let fieldBuffers = [];

    fields.forEach((field) => {
        let fieldBuffer = new Buffer(32);
        fieldBuffer.asciiWrite(zeroFill(field.name, 11, 'right'), 0, 11);
        const type = field.type.charAt(0);
        fieldBuffer.asciiWrite(type, 11, 1);
        // Field data address (address is set in memory; not useful on disk).
        fieldBuffer.writeUInt32LE(0, 12, 4);
        fieldBuffer.writeUInt8(field.length, 16, 1);
        fieldBuffer.writeUInt8(FIELD_SIZES[type], 17);
        fieldBuffer.writeUInt16LE(0, 18, 2); // reserved
        fieldBuffer.writeUInt8(0, 20, 1); // work area id - reserved
        fieldBuffer.writeUInt8(0, 21, 10); // reserved
        fieldBuffer.writeUInt8(0, 31, 1); // index flag

        fieldBuffers.push(fieldBuffer);
        writeFieldOffset += FIELD_OFFSET_SIZE;
    });

    fileBuffer = Buffer.concat([headerBuffer, ...fieldBuffers],
                               fieldBuffers.reduce((memo, buff) => {
        return memo + buff.length;
    }, fileBuffer.length + 1));

    fileBuffer.writeUInt8(FIELD_DELIMITER, writeFieldOffset, 1);

    fs.writeFile('./new.dbf', fileBuffer, () => {
        fs.readFile('./new.dbf', (err, buff) => {
            console.log('NEW FILE!');
            readBuffer(buff);
        });
    });
});


function readBuffer(buffer) {
    // Decode
    const header = decodeHeader(buffer);
    console.log(header);
    const fields = decodeFields(buffer);
    console.log(fields);
    // let records = decodeRecords(buffer, fields, header);
    // console.log(records);
}
