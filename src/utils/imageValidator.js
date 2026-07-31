const sharp = require('sharp');

/**
 * Check if an image has a predominantly white background
 * @param {Buffer} imageBuffer - The image buffer to validate
 * @param {number} threshold - Threshold for white detection (0-255), default 240
 * @param {number} tolerance - Percentage of pixels that can be non-white, default 5%
 * @returns {Promise<boolean>} - True if background is predominantly white
 */
async function hasWhiteBackground(imageBuffer, threshold = 240, tolerance = 5) {
  try {
    // Resize image for faster processing (max 200x200)
    const { data, info } = await sharp(imageBuffer)
      .resize(200, 200, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const totalPixels = width * height;
    let whitePixels = 0;

    // Check edge pixels (top, bottom, left, right borders)
    const borderWidth = Math.min(10, Math.floor(width / 4));
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Only check border pixels
        const isBorder = x < borderWidth || x >= width - borderWidth || 
                        y < borderWidth || y >= height - borderWidth;
        
        if (isBorder) {
          const i = (y * width + x) * channels;
          
          // For RGB images
          if (channels >= 3) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Check if pixel is white (all channels above threshold)
            if (r >= threshold && g >= threshold && b >= threshold) {
              whitePixels++;
            }
          }
        }
      }
    }

    const borderPixels = 2 * borderWidth * (width + height) - 4 * borderWidth * borderWidth;
    const whitePercentage = (whitePixels / borderPixels) * 100;

    return whitePercentage >= (100 - tolerance);
  } catch (error) {
    console.error('White background validation error:', error);
    // If validation fails, allow the image (fail-safe)
    return true;
  }
}

/**
 * Validate image dimensions and format
 * @param {Buffer} imageBuffer - The image buffer to validate
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} - Validation result
 */
async function validateImage(imageBuffer, options = {}) {
  const {
    minWidth = 300,
    minHeight = 300,
    maxWidth = 5000,
    maxHeight = 5000,
    maxSizeMB = 5,
    formats = ['jpeg', 'png', 'jpg'],
  } = options;

  try {
    const metadata = await sharp(imageBuffer).metadata();

    // Check format
    if (!formats.includes(metadata.format)) {
      return {
        valid: false,
        error: `Invalid format. Allowed: ${formats.join(', ')}`,
      };
    }

    // Check dimensions
    if (metadata.width < minWidth || metadata.height < minHeight) {
      return {
        valid: false,
        error: `Image too small. Minimum: ${minWidth}x${minHeight}px`,
      };
    }

    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      return {
        valid: false,
        error: `Image too large. Maximum: ${maxWidth}x${maxHeight}px`,
      };
    }

    // Check file size
    const sizeMB = imageBuffer.length / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      return {
        valid: false,
        error: `File too large. Maximum: ${maxSizeMB}MB`,
      };
    }

    return { valid: true, metadata };
  } catch (error) {
    console.error('Image validation error:', error);
    return {
      valid: false,
      error: 'Invalid image file',
    };
  }
}

module.exports = {
  hasWhiteBackground,
  validateImage,
};
