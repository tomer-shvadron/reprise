/**
 * The package's one size cap, 256 MiB: on a file `read` is given, and on the inflated size a gp
 * zip entry or a gpx BCFZ header declares, since both are allocated up front.
 */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
