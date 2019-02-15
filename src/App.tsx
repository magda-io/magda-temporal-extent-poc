import React, { Component } from "react";
import logo from "./logo.svg";
import "./App.css";
import FileDrop from "react-file-drop";
import XLSX from "xlsx";
import { uniq } from "lodash";
const chrono = require("chrono-node");

const READ_AS_BINARY_STRING = false;

const DATE_REGEX_PART = ".*(date|dt|decade|year).*";
const DATE_REGEX = new RegExp(DATE_REGEX_PART, "i");
const START_DATE_REGEX = new RegExp(".*(start|st)" + DATE_REGEX_PART, "i");
const END_DATE_REGEX = new RegExp(".*(end)" + DATE_REGEX_PART, "i");

const buildSpatialRegex = (part: string) =>
    new RegExp(`.*(${part})($|[^a-z^A-Z])+.*`, "i");

const LONG_REGEX = buildSpatialRegex("long|lng|longitude");
const LAT_REGEX = buildSpatialRegex("lat|latitude|lt");

const EARLIEST_POSSIBLE_MOMENT = new Date(-8640000000000000);
const LATEST_POSSIBLE_MOMENT = new Date(8640000000000000);

const MAX_POSSIBLE_LAT = 90;
const MIN_POSSIBLE_LAT = -90;
const MAX_POSSIBLE_LNG = 360;
const MIN_POSSIBLE_LNG = -360;

function tryFilterHeaders(headers: string[], ...regexes: RegExp[]) {
    for (const thisRegex of regexes) {
        const matchingHeaders = headers.filter(header =>
            thisRegex.test(header)
        );

        if (matchingHeaders.length > 0) {
            return matchingHeaders;
        }
    }

    return [];
}

function preferYears(chronoOutput: any) {
    if (
        !chronoOutput.knownValues.year &&
        typeof chronoOutput.knownValues.hour !== "undefined" &&
        typeof chronoOutput.knownValues.minute !== "undefined"
    ) {
        chronoOutput.knownValues.year =
            chronoOutput.knownValues.hour.toString().padStart(2, "0") +
            chronoOutput.knownValues.minute.toString().padStart(2, "0");
        chronoOutput.knownValues.hour = undefined;
        chronoOutput.knownValues.minute = undefined;
    }

    return chronoOutput;
}

function pickMoment(
    rawDate: string,
    toCompare: Date,
    getBetter: (moment1: Date, moment2: Date) => Date
) {
    const parsed: Array<any> =
        rawDate && rawDate.length > 0 && chrono.strict.parse(rawDate);

    if (parsed && parsed.length > 0 && parsed[0].start) {
        const startDate = preferYears(parsed[0].start).date();

        const betterDate = parsed[0].end
            ? getBetter(startDate, preferYears(parsed[0].end).date())
            : startDate;

        return getBetter(betterDate, toCompare);
    } else {
        return toCompare;
    }
}

function getBetterLatLng(
    rawLatLng: string,
    toCompare: number,
    min: number,
    max: number,
    getBetter: (number1: number, number2: number) => number
) {
    const parsed: number = Number.parseFloat(rawLatLng);

    if (parsed && !isNaN(parsed) && parsed >= min && parsed <= max) {
        return getBetter(parsed, toCompare);
    } else {
        return toCompare;
    }
}

type DateAggregation = {
    earliestStart: Date;
    latestEnd: Date;
};

type SpatialExtent = {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
};

function aggregateDates(rows: any[], headers: string[]) {
    const dateHeaders = tryFilterHeaders(headers, DATE_REGEX);

    const startDateHeaders = tryFilterHeaders(headers, START_DATE_REGEX);
    const endDateHeaders = tryFilterHeaders(headers, END_DATE_REGEX);
    const startDateHeadersInOrder = uniq(
        startDateHeaders.concat(dateHeaders).concat(endDateHeaders)
    );
    const endDateHeadersInOrder = uniq(
        endDateHeaders.concat(dateHeaders).concat(startDateHeaders)
    );

    console.log(
        "Start Date Headers: " + JSON.stringify(startDateHeadersInOrder)
    );
    console.log("End Date Headers: " + JSON.stringify(endDateHeadersInOrder));

    const dateAgg = rows.reduce(
        (soFar: DateAggregation, row: any) => {
            return {
                earliestStart: startDateHeadersInOrder.reduce(
                    (earliestStart: Date, header: string) =>
                        pickMoment(row[header], earliestStart, (date1, date2) =>
                            date1.getTime() <= date2.getTime() ? date1 : date2
                        ),
                    soFar.earliestStart
                ),
                latestEnd: endDateHeadersInOrder.reduce(
                    (latestEnd: Date, header: string) =>
                        pickMoment(row[header], latestEnd, (date1, date2) =>
                            date1.getTime() > date2.getTime() ? date1 : date2
                        ),
                    soFar.latestEnd
                )
            };
        },
        {
            earliestStart: LATEST_POSSIBLE_MOMENT,
            latestEnd: EARLIEST_POSSIBLE_MOMENT
        } as DateAggregation
    );
    const { earliestStart, latestEnd } = dateAgg;

    const earliestNotFound =
        earliestStart.getTime() === LATEST_POSSIBLE_MOMENT.getTime();
    const latestNotFound =
        latestEnd.getTime() === EARLIEST_POSSIBLE_MOMENT.getTime();

    console.log(
        "Earliest start: " +
            (earliestNotFound ? "Not found" : earliestStart.toString())
    );
    console.log(
        "Latest end: " + (latestNotFound ? "Not found" : latestEnd.toString())
    );

    return {
        earliestStart: !earliestNotFound && earliestStart,
        latestEnd: !latestNotFound && latestEnd
    };
}

function getGreater(num1: number, num2: number) {
    return num1 > num2 ? num1 : num2;
}

function getSmaller(num1: number, num2: number) {
    return num1 <= num2 ? num1 : num2;
}

function calculateSpatialExtent(rows: any[], headers: string[]) {
    const latHeaders = tryFilterHeaders(headers, LAT_REGEX);
    const longHeaders = tryFilterHeaders(headers, LONG_REGEX);

    console.log("Longitude Headers: " + JSON.stringify(longHeaders));
    console.log("Latitude Headers: " + JSON.stringify(latHeaders));

    const spatial = rows.reduce(
        (soFar: SpatialExtent, row: any) => {
            const getBestCoordinateComponent = (
                min: number,
                max: number,
                fn: (number1: number, number2: number) => number
            ) => (bestNumberSoFar: number, header: string) => {
                return getBetterLatLng(
                    row[header],
                    bestNumberSoFar,
                    min,
                    max,
                    fn
                );
            };

            return {
                maxLat: latHeaders.reduce(
                    getBestCoordinateComponent(
                        MIN_POSSIBLE_LAT,
                        MAX_POSSIBLE_LAT,
                        getGreater
                    ),
                    soFar.maxLat
                ),
                minLat: latHeaders.reduce(
                    getBestCoordinateComponent(
                        MIN_POSSIBLE_LAT,
                        MAX_POSSIBLE_LAT,
                        getSmaller
                    ),
                    soFar.minLat
                ),
                maxLng: longHeaders.reduce(
                    getBestCoordinateComponent(
                        MIN_POSSIBLE_LNG,
                        MAX_POSSIBLE_LNG,
                        getGreater
                    ),
                    soFar.maxLng
                ),
                minLng: longHeaders.reduce(
                    getBestCoordinateComponent(
                        MIN_POSSIBLE_LNG,
                        MAX_POSSIBLE_LNG,
                        getSmaller
                    ),
                    soFar.minLng
                )
            };
        },
        {
            maxLat: Number.MIN_SAFE_INTEGER,
            minLat: Number.MAX_SAFE_INTEGER,
            maxLng: Number.MIN_SAFE_INTEGER,
            minLng: Number.MAX_SAFE_INTEGER
        } as SpatialExtent
    );

    console.log(`Longitude: ${spatial.minLng} to ${spatial.maxLng}`);
    console.log(`Latitude: ${spatial.minLat} to ${spatial.maxLat}`);

    return {
        maxLat: spatial.maxLat !== Number.MIN_SAFE_INTEGER && spatial.maxLat,
        minLat: spatial.minLat !== Number.MAX_SAFE_INTEGER && spatial.minLat,
        maxLng: spatial.maxLng !== Number.MIN_SAFE_INTEGER && spatial.maxLng,
        minLng: spatial.minLng !== Number.MAX_SAFE_INTEGER && spatial.minLng
    };
}

class App extends Component {
    state = {
        loading: false
    } as {
        dates?: DateAggregation;
        spatial?: SpatialExtent;
        loading: boolean;
        error?: Error;
    };

    onDrop = (fileList: FileList, event: React.DragEvent<HTMLDivElement>) => {
        const files = event.dataTransfer.files;
        const f = files[0];
        const reader = new FileReader();

        this.setState({
            loading: true,
            dateAgg: undefined,
            spatial: undefined
        });

        reader.onload = e => {
            if (!e.target) {
                throw new Error("No target for event");
            }

            try {
                const data = !READ_AS_BINARY_STRING
                    ? new Uint8Array((e.target as any).result)
                    : (e.target as any).result;
                const workbook = XLSX.read(data, {
                    type: READ_AS_BINARY_STRING ? "binary" : "array"
                });

                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(worksheet);

                if (!rows.length) {
                    throw new Error("Empty");
                }

                const rowOne = rows[0];
                const headers = Object.keys(rowOne);

                const dateAgg = aggregateDates(rows, headers);
                const spatialExtent = calculateSpatialExtent(rows, headers);

                this.setState({
                    dates: dateAgg,
                    spatial: spatialExtent,
                    loading: false
                });
            } catch (e) {
                this.setState({ error: e, loading: false });
                console.error(e);
            }
        };

        if (READ_AS_BINARY_STRING) {
            reader.readAsBinaryString(f);
        } else {
            reader.readAsArrayBuffer(f);
        }
    };

    render() {
        return (
            <div className="App">
                <header className="App-header">
                    <FileDrop onDrop={this.onDrop}>
                        <img src={logo} className="App-logo" alt="logo" />
                    </FileDrop>
                    <p>Drop an excel or a csv on the spinny thing!</p>
                    {this.state.loading && <p>Loading...</p>}
                    {this.state.error && (
                        <p>Error: {this.state.error.toString()}</p>
                    )}
                    {this.state.dates && (
                        <React.Fragment>
                            <p>
                                Earliest date:{" "}
                                {this.state.dates.earliestStart.toString()}
                            </p>
                            <p>
                                Latest date:{" "}
                                {this.state.dates.latestEnd.toString()}
                            </p>
                        </React.Fragment>
                    )}
                    {this.state.spatial && (
                        <React.Fragment>
                            <p>
                                Longitude:
                                {this.state.spatial.minLng || "NULL"} to{" "}
                                {this.state.spatial.maxLng || "NULL"}
                            </p>
                            <p>
                                Latitude:
                                {this.state.spatial.minLat || "NULL"} to{" "}
                                {this.state.spatial.maxLat || "NULL"}
                            </p>
                        </React.Fragment>
                    )}
                    <a
                        className="App-link"
                        href="https://reactjs.org"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Learn React
                    </a>
                </header>
            </div>
        );
    }
}

export default App;
